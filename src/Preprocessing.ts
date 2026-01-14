import { APIGatewayEvent, APIGatewayProxyResult, Callback, Context, Handler } from "aws-lambda";
import _ from "lodash";
import { CacheClient, CacheClient as cacheClient } from "@flairlabs/flair-aws-infra";
import axios, { AxiosResponse } from 'axios';
import { AlexaMap } from "./Model/AlexaMap";


interface preProcResponse {
  statusCode: number;
  body: any;
}

const handler = async (event: any, context: Context): Promise<any> => {
  console.log(`Event: ${JSON.stringify(event, null, 2)}`);
  let resp = await preProcess(event)
  return resp
};

export async function preProcess(_event: any) {
  console.log("Pre processing...")
  let resp = {
    statusCode: 500,
    payload: {}
  }
  let _cacheClient = cacheClient.getCacheClient()
  // console.log("Pre Proccessing invoked")
  let event = JSON.parse(_.get(_event, "body") || "{}")
  // let alexaRequest = JSON.parse(_.get(_event, "body") || "{}")
  let alexaRequest = JSON.parse(_.get(event, "body") || "{}")
  // console.log("#####28. " + JSON.stringify(alexaRequest))
  let pathParameters = event.pathParameters || {};

  let appName = pathParameters["appName"] || "empty"
  let stage = pathParameters["stage"] || "empty"
  let skillName = pathParameters["skillName"] || "empty"
  let platform = pathParameters["source"] || "empty"
  let version = pathParameters["version"] ? pathParameters["version"] : "dev";

  let requestType = alexaRequest.request.type;
  let locale = alexaRequest.request.locale;
  let requestId = _.get(alexaRequest, "request.requestId")
  let sessionId = _.get(alexaRequest, "session.sessionId") || null;
  let timeStamp = _.get(alexaRequest, "request.timestamp") || null;
  // let userId = _.get(alexaRequest, "session.user.userId") || null;
  let userId = _.get(alexaRequest, "context.System.user.userId") || null;
  let isNewSession = _.get(alexaRequest, "session.new") || false;

  let args: any = {}

  let supportedInterfaces = _.get(alexaRequest, "context.System.device.supportedInterfaces") || {}

  let sessionData = _.get(alexaRequest, "session.attributes") || {}

  args["APP_INFORMATION"] = {
    API_ENDPOINT: alexaRequest.context.System.apiEndpoint,
    API_ACCESS_TOKEN: alexaRequest.context.System.apiAccessToken,
    REQUEST_ID: alexaRequest.request.requestId,
    SUPPORTED_INTERFACES: supportedInterfaces
  }
  let isDisplayEnabled = supportedInterfaces["Alexa.Presentation.APL"] || supportedInterfaces["Display"] ? true : false
  let intentName = "UNKNOWN"
  let body = {
    VERB: intentName,
    LOCALE: locale,
    SESSION_ID: sessionId,
    REQUEST_ID: requestId,
    TIMESTAMP: timeStamp,
    USER_ID: userId,
    IS_NEW_SESSION: isNewSession,
    APP_NAME: appName,
    SKILL_NAME: skillName,
    STAGE: stage,
    VERSION: version,
    ARGS: args,
    PLATFORM: platform,
    SESSION_DATA: sessionData
  }
  try {
    let result = await Promise.all([getAlexaMap(_cacheClient), getDeviceConfig(alexaRequest, isDisplayEnabled)])
    let alexaMap = result[0]
    args["DEVICE_CONFIG"] = result[1]
    intentName = alexaMap.REQUEST_TYPES[requestType] || "UNKNOWN"
    if (intentName == alexaMap.REQUEST_TYPES.LaunchRequest) {
      let target = _.get(alexaRequest, "request.target") || {}
      if (alexaRequest.request["task"] && alexaRequest.request["task"]["input"]) {
        let customTaskArgs = JSON.stringify(alexaRequest.request["task"]["input"] || "{}") || {};
        intentName = "CUSTOM_TASK";
        args["CUSTOM_TASK_ARGS"] = customTaskArgs;
      } else if (!_.isEmpty(target)) { //Handling for Routine Launch
        let routineArgs = JSON.stringify(target) || {}
        intentName = "ROUTINE_LAUNCH"
        args["ROUTINE_ARGS"] = routineArgs
      }
    } else if (intentName == alexaMap.REQUEST_TYPES.IntentRequest) {
      intentName = alexaRequest.request.intent.name;
      intentName = alexaMap.BUILD_IN_INTENTS[intentName] || intentName
      // console.log("alexaRequest")
      // console.log(JSON.stringify(alexaRequest))
      // console.log("!_.isEmpty(alexaRequest.request.intent.slots)")
      // console.log(!_.isEmpty(alexaRequest.request.intent.slots))
      if (!_.isEmpty(alexaRequest.request.intent.slots)) args["SLOT_VALUES"] = getSlotTypes(alexaRequest.request.intent.slots)
    } else if (intentName == alexaMap.REQUEST_TYPES["Alexa.Presentation.APL.UserEvent"]) {
      let aplArgs = alexaRequest.request.arguments || []
      if (aplArgs.length > 0) {
        let slotIndex = _.findIndex(aplArgs, (e: any) => { return e && e.SLOT })
        // console.log("SLOTINDEX: "+slotIndex)
        if (slotIndex > -1) {
          let slot = aplArgs[slotIndex]
          // console.log("SLOT: " + slot)
          if (slot) slot["SLOT"]["REASON"] = "USER_TOUCH_EVENT"
          aplArgs[slotIndex] = slot
        }
      }
      args["USER_EVENT_ARGS"] = aplArgs || []
    } else if (intentName == "AUDIO_PLAYER" || intentName == "PLAYBACK_CONTROLLER") {
      let arr = _.toUpper(requestType).split(".")
      let actionName = ""
      if (arr.length > 0) actionName = arr.join("_")
      args["AUDIO_PLAYER"] = {
        action: actionName,
        data: alexaRequest.context.AudioPlayer || {}
      }
    } else if (intentName == alexaMap.REQUEST_TYPES["Connections.Response"]) {
      args["CONNECTION_RESPONSE"] = {
        NAME: alexaRequest.request.name || "",
        TOKEN: alexaRequest.request.token || "",
        PAYLOAD: alexaRequest.request.payload || {}
      }
    } else if (intentName == alexaMap.REQUEST_TYPES["SessionResumedRequest"]) {
      args["SESSION_RESUMED"] = {
        CAUSE: alexaRequest.request.cause || undefined
      }
    } else if (intentName == alexaMap.REQUEST_TYPES["SessionEndedRequest"]) {
      args["SESSION_END"] = {
        CAUSE: alexaRequest.request.cause || undefined,
        REASON: alexaRequest.request.reason || undefined,
        ERROR: alexaRequest.request.error || undefined
      }
    } else if (intentName == alexaMap.REQUEST_TYPES["System.ExceptionEncountered"]) {
      args["SYSTEM_EXCEPTION"] = {
        CAUSE: alexaRequest.request.cause || undefined,
        ERROR: alexaRequest.request.error || undefined
      }
    }

    if (_.has(alexaRequest, "request")) {
      let rawRequest = _.get(alexaRequest, "request")
      args["RAW_REQUEST"] = rawRequest;
    }

    let abTest = _.get(alexaRequest, "context.Experimentation.activeExperiments") || []
    if (abTest && abTest.length > 0) args["AB_TEST"] = { ACTIVE_EXPERIMENTS: abTest }

    //if user has linked account
    let accessToken = _.get(alexaRequest, "context.System.user.accessToken") || null
    if (accessToken) args["USER_API_ASSETS"] = { ACCESS_TOKEN: accessToken }

    let aplData = _.get(alexaRequest["context"], "Alexa.Presentation.APL") || {}
    // console.log("aplData: " + JSON.stringify(aplData))
    if (!_.isEmpty(aplData)) {
      let components = _.get(aplData, "componentsVisibleOnScreen") || []
      // console.log("components: " + JSON.stringify(components))
      if (components.length > 0) {
        let ele = components[0] || null
        let children = _.get(ele, "children") || []
        // console.log("children: " + JSON.stringify(children))
        let videoPlayerData = _.filter(children, (e) => { return e && e.id == "videoPlayer" })[0] || null
        // console.log("videoPlayerData: " + JSON.stringify(videoPlayerData))
        if (videoPlayerData) {
          let mediaData = _.get(videoPlayerData, "tags.media") || {}
          // console.log("mediaData: " + JSON.stringify(mediaData))
          if (!_.isEmpty(mediaData)) {
            args["VIDEO_PLAYER_DATA"] = {
              offset: _.get(mediaData, "positionInMilliseconds") || 0,
              state: _.get(mediaData, "state") || "",
              url: _.get(mediaData, "url")
            }
          }
        }
      }
    }
    body.ARGS = args
    body.VERB = intentName

    resp["statusCode"] = 200
    resp["payload"] = body
  } catch (err: unknown) {
    const e = err as Error;
    console.error("Error: " + JSON.stringify(e))
    console.error(e)
  } finally {
    // console.log("resp")
    // console.log(JSON.stringify(resp))
    return resp
  }
}

async function getDeviceConfig(body: any, isDisplayEnabled: boolean): Promise<any> {
  let deviceConfig: any = {}
  let device = _.get(body, "context.System.device") || null
  if (device) {
    let deviceId = body.context.System.device.deviceId;
    let accessToken = body.context.System.apiAccessToken;
    let config = {
      url: `/v2/devices/${deviceId}/settings/System.timeZone`,
      method: 'get',
      baseURL: 'https://api.amazonalexa.com',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      params: { deviceId: deviceId }
    }
    let url = `https://api.amazonalexa.com/v2/devices/${deviceId}/settings/System.timeZone`
    let tz = "America/Los_Angeles"
    try {
      let resp: AxiosResponse = await axios.get(url, config)
      tz = resp && resp.data ? resp.data : tz
    } catch (e: unknown) {
      const err = e as Error;
      console.error(`Error while fetching timeZone: ${url} ${JSON.stringify(config)} ${JSON.stringify(err)}`, err)
    }
    deviceConfig["DEVICE_TIMEZONE"] = tz
    let pixelHeight = 0, pixelWidth = 0, deviceType = "NON_SCREEN", dpi = "", lastaplToken = "", aplMaxVersion = "", canRotate = false;
    try {
      if (isDisplayEnabled) {
        let mode = _.get(body.context, 'Viewport.mode', 'DEVELOPER_CONSOLE')
        let shape = _.get(body.context, 'Viewport.shape', 'WEB')
        deviceType = `${mode}_${shape}`;
        if (mode == "DEVELOPER_CONSOLE" && shape == "WEB") {
          isDisplayEnabled = false
        } else {
          if (body.context["Alexa.Presentation.APL"]) lastaplToken = body.context["Alexa.Presentation.APL"].token;
          let aplInfo = body.context.System.device.supportedInterfaces["Alexa.Presentation.APL"]
          dpi = body.context.Viewport.dpi ?? "";
          aplMaxVersion = aplInfo.runtime.maxVersion
          pixelHeight = body.context.Viewport.pixelHeight
          pixelWidth = body.context.Viewport.pixelWidth
          let element = body.context.Viewports && body.context.Viewports.length > 0 ? body.context.Viewports.filter((ele: any) => { return ele && ele.canRotate }) : []
          if (element.length > 0) canRotate = true
        }
        // console.log(element)
      }
    } catch (e) {
      console.error(`Error while processing display enabled: ${JSON.stringify(e)}`)
      isDisplayEnabled = false
    }

    deviceConfig["DEVICE_ID"] = deviceId
    deviceConfig["DEVICE_TYPE"] = deviceType
    deviceConfig["IS_DISPLAY_ENABLED"] = isDisplayEnabled
    deviceConfig["HEIGHT"] = pixelHeight
    deviceConfig["WIDTH"] = pixelWidth
    deviceConfig["DPI"] = dpi
    deviceConfig["APL_MAX_VERSION"] = aplMaxVersion
    deviceConfig["CAN_ROTATE"] = canRotate
    deviceConfig["LAST_APL_TOKEN"] = lastaplToken
    return deviceConfig
  }
}

function getSlotTypes(slots: any): any[] {
  let slotKeys = _.keys(slots)
  let slotObjArr: any = []
  slotKeys.forEach((ele) => {
    if (slots[ele] && slots[ele].slotValue) {

      if (_.has(slots[ele].slotValue, 'resolutions.resolutionsPerAuthority')) {
        const resolutionsPerAuthorityArr = slots[ele].slotValue.resolutions.resolutionsPerAuthority;
        for (const resolution of resolutionsPerAuthorityArr) {
          let slotObject;
          if (_.has(resolution, 'values')) {
            const val = resolution.values[0].value
            const authorityKey = resolution.authority;
            slotObject = {
              SLOT_ID: val.id || slots[ele].id || slots[ele].name,
              SLOT_VALUE: val.value || val.name || slots[ele].value,
              SLOT_RAW_VALUE: slots[ele].value,
              SLOT_NAME: val.name || slots[ele].name,
              SLOT_TYPE: slots[ele].name,
              REASON: (authorityKey.includes("dynamic")) ? "DYNAMIC" : "STATIC"
            };
          } else {
            slotObject = {
              SLOT_ID: slots[ele].id || slots[ele].name,
              SLOT_VALUE: slots[ele].value || slots[ele].name,
              SLOT_RAW_VALUE: slots[ele].value,
              SLOT_NAME: slots[ele].name,
              SLOT_TYPE: slots[ele].name,
              REASON: "UNSURE"
            };
          }
          // if(resolution.status.code == "ER_SUCCESS_MATCH"){
          slotObjArr.push(slotObject)
          // }
        }
      } else {
        let slotObject = {
          SLOT_ID: slots[ele].id || slots[ele].name,
          SLOT_VALUE: slots[ele].value,
          SLOT_RAW_VALUE: slots[ele].value,
          SLOT_NAME: slots[ele].name,
          SLOT_TYPE: slots[ele].name,
          REASON: "UNSURE"
        }

        slotObjArr.push(slotObject)
      }
    }
  })
  // console.log("slotObj")
  // console.log(JSON.stringify(slotObj))
  return slotObjArr
}

function getAlexaMap(cacheClient: CacheClient): Promise<AlexaMap> {
  return new Promise((resolve, reject) => {
    let stage = process.env.PRE_STAGE == "DEV" ? "TEST" : process.env.PRE_STAGE
    let path = `${process.env.GENERAL_DATA}/${stage}/AlexaMap.json`
    cacheClient.getObject(path, AlexaMap, (err: any, data: any) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
}