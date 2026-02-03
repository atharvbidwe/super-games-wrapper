import { Callback, Context, Handler } from "aws-lambda";

import { CacheClient as cacheClient, DynamoDao } from "@flairlabs/flair-aws-infra";
import _ = require("lodash");
import { ActionResponse, IDao } from "@flairlabs/flair-infra";

interface postProcResponse {
    statusCode: number;
    body: string;
}
export class GenericModel {
    [model: string]: any
}
let _cacheClient = cacheClient.getCacheClient()
const postProcessing: Handler = async (event: any): Promise<any> => {
    // console.log("PostProcessing Invoked")
    console.log("EVENT: " + JSON.stringify(event))
    let _resp = await postProcess(event)
    let postResp = {
        statusCode: 200,
        Payload: JSON.stringify(_resp)
    }
    return postResp
};

export async function postProcess(event: any): Promise<any> {
    console.log("Post processing")
    console.log(event)
    let response: any = new ActionResponse();
    let files: any[] = []
    let templates: any[] = []
    let _resp: any = {
        version: "1.0",
        response: {}
    }

    if (!event || _.isEmpty(event)) {
        return _resp
    } else {
        response = JSON.parse(_.get(event, "Payload"))
        // console.log("PAYLOAD : " + JSON.stringify(response))
        try {
            if (response.ACTION.APL) {
                files.push(getTemplate(response.OBJS.aplData || {}, 'APL'))
            }
            if (response.ACTION.APLA) {
                files.push(getTemplate(response.OBJS.aplaData || {}, 'APLA'))
            }
            let result = await Promise.all(files)
            if (result.length > 0) {
                result.forEach((ele) => {
                    templates.push(ele)
                })
            }
            let directives: any[] = []
            let outputSpeech: any = {}
            let reprompt: any = {}
            let card: any = {}

            if (response.ACTION.shouldEndSession == true || response.ACTION.shouldEndSession == false) _resp.response["shouldEndSession"] = response.ACTION.shouldEndSession

            if (response.ACTION.APLA) {
                let apladata = _.find(templates, (ele) => { return ele && ele.TYPE == "APLA" }) || {}
                directives.push({
                    type: "Alexa.Presentation.APLA.RenderDocument",
                    token: apladata["TOKEN"],
                    document: apladata["DOCUMENT"] || {},
                    datasources: {
                        data: response.DATA || {}
                    }
                })
            }

            let aplToken: any = response.DATA && response.DATA.aplToken ? response.DATA.aplToken : undefined
            if (response.ACTION.APL || response.ACTION.MEDIA_PLAYER || response.ACTION.COMMANDS_ONLY) {
                let apldata = _.find(templates, (ele) => { return ele && ele.TYPE == "APL" }) || {}
                aplToken = aplToken ? aplToken : apldata["TOKEN"]
                let sources: any = {};
                let promises: any[] = []
                if (response.DATA.aplaSources && response.DATA.aplaSources.length > 0) {
                    response.DATA.aplaSources.forEach((ele: any) => {
                        promises.push(getTemplate(ele, 'APLA'))
                    })
                }
                let APLAs = await Promise.all(promises)
                APLAs.forEach((ele: any) => {
                    sources[`${ele.TOKEN}`] = ele["DOCUMENT"]
                })
                // console.log("sources: "+JSON.stringify(sources))
                // console.log("apldata")
                // console.log(JSON.stringify(apldata))
                // console.log(JSON.stringify(templates))
                if (response.ACTION.APL) {
                    directives.push({
                        type: "Alexa.Presentation.APL.RenderDocument",
                        token: aplToken,
                        sources: sources,
                        document: apldata["DOCUMENT"],
                        datasources: {
                            data: response.DATA || {},
                            aplSpeechObj: response.DATA.aplSpeechObj || {}
                        }
                    })
                }
                let commands: any[] = []

                if (response.OBJS && response.OBJS.sendEvent) {
                    commands.push({
                        type: "SendEvent",
                        token: response.OBJS && response.OBJS.sendEvent && response.OBJS.sendEvent.token ? response.OBJS.sendEvent.token : aplToken || "",
                        arguments: response.OBJS && response.OBJS.sendEvent && response.OBJS.sendEvent.arguments ? response.OBJS.sendEvent.arguments : []
                    })
                }

                if (response.OBJS && response.OBJS.commands) {
                    commands.push(...response.OBJS.commands)
                }

                if (response.OBJS && response.OBJS.finish && !_.isEmpty(response.OBJS.finish)) {
                    commands.push({
                        type: "Finish",
                    })
                }
                if (response.OBJS && response.OBJS.setValue && response.OBJS.setValue.length > 0) {
                    response.OBJS.setValue.forEach((ele: any) => {
                        commands.push({
                            type: "SetValue",
                            componentId: ele.componentId || "",
                            property: ele.property || "",
                            value: ele.value || ""
                        })
                    })
                }
                if (response.OBJS && response.OBJS.speakItems && response.OBJS.speakItems.length > 0) {
                    response.OBJS.speakItems.forEach((ele: any) => {
                        commands.push({
                            type: "SpeakItem",
                            componentId: ele.componentId || ""
                        })
                    })
                }
                if (response.ACTION.MEDIA_PLAYER) {
                    if (!_.isEmpty(response.DATA.mediaData) && response.DATA.mediaData.length > 0) {
                        response.DATA.mediaData.forEach((ele: any) => {
                            let commandToInsert: any = {
                                type: "ControlMedia",
                                componentId: ele.compId || "videoPlayer",
                                command: ele.command || "",
                                token: ele.token || aplToken || ""
                            }
                            if (ele && (ele.command == "seek" || ele.command == "seekTo")) {
                                commandToInsert["value"] = response.DATA.offset || 0
                            }
                            commands.push(commandToInsert)
                        });
                    }
                }
                if (commands.length > 0) {
                    directives.push({
                        type: 'Alexa.Presentation.APL.ExecuteCommands',
                        token: aplToken || _.get(response.OBJS.aplData, "TOKEN") || "",
                        commands: commands
                        // commands: [
                        //   {
                        //     type: response.DATA && response.DATA.commandOrderType ? response.DATA.commandOrderType : "Parallel",
                        //     commands: commands
                        //   }
                        // ]
                    })
                }
            }


            if (response.ACTION.sendRequest) {
                directives.push({
                    type: "Connections.SendRequest",
                    token: response.OBJS.sendRequestData.token || "",
                    name: response.OBJS.sendRequestData.name || "",
                    payload: response.OBJS.sendRequestData.payload || {}
                })
            }

            if (response.ACTION.prompt) {
                // respBuilder.speak(response.DATA.promptSpeech || "")
                outputSpeech["type"] = "SSML"
                outputSpeech["ssml"] = `<speak>${response.DATA.promptSpeech || ""}</speak>`
            } else if (response.ACTION.speechText) {
                outputSpeech["type"] = "PlainText"
                outputSpeech["text"] = response.DATA.promptSpeech || ""
            }
            if (response.ACTION.reprompt) {
                // respBuilder.reprompt(response.DATA.repromptSpeech || "")
                let outputSpeechReprompt: any = {}
                if (!response.ACTION.repromptSpeechText) {
                    outputSpeechReprompt["type"] = "SSML"
                    outputSpeechReprompt["ssml"] = `<speak>${response.DATA.repromptSpeech || ""}</speak>`
                } else if (response.ACTION.repromptSpeechText) {
                    outputSpeechReprompt["type"] = "PlainText"
                    outputSpeechReprompt["text"] = response.DATA.repromptSpeech || ""
                }
                reprompt["outputSpeech"] = outputSpeechReprompt
            }

            //check whether card is sent. If yes, check according to its type
            if (response.OBJS && response.OBJS.cardData) {
                switch (response.OBJS.cardData.type || "") {
                    case "Simple":
                        card["type"] = response.OBJS.cardData.type
                        card["title"] = response.OBJS.cardData.title || ""
                        card["content"] = response.OBJS.cardData.content || ""
                        break;
                    case "Standard":
                        card["type"] = response.OBJS.cardData.type
                        card["text"] = response.OBJS.cardData.text || ""
                        card["title"] = response.OBJS.cardData.title || ""
                        card["image"] = {
                            smallImageUrl: response.OBJS.cardData.smallImageUrl || "",
                            largeImageUrl: response.OBJS.cardData.largeImageUrl || ""
                        }
                        break;
                    case "LinkAccount":
                        card["type"] = response.OBJS.cardData.type
                        break;
                    case "AskForPermissionsConsent":
                        card["type"] = response.OBJS.cardData.type
                        card["permissions"] = response.OBJS.cardData.permissions || []
                        break;
                    default:
                        console.log("Invalid Card type: " + response.OBJS.cardData.type || "");
                        break
                }
            }

            if (response.ACTION.sendConnection) {
                if (!_.isEmpty(response.OBJS.sendConnectionData)) {
                    let sendConnection = response.OBJS.sendConnectionData
                    directives.push({
                        type: "Connections.StartConnection",
                        // uri: `connection://${sendConnection.id}.${sendConnection.customTaskName}?provider=${sendConnection.id}`,
                        uri: sendConnection.uri,
                        onCompletion: sendConnection.onCompletion || "SEND_ERRORS_ONLY",
                        input: sendConnection.payload || "{}"
                    })
                }
            }

            if (response.ACTION.taskComplete) {
                if (!_.isEmpty(response.OBJS.taskData)) {
                    directives.push({
                        type: "Tasks.CompleteTask",
                        status: {
                            code: response.OBJS.taskData["statusCode"] || 200,
                            message: response.OBJS.taskData["message"] || ""
                        },
                        result: {
                            payload: response.OBJS.taskData["payload"] || "[]"
                        }
                    })
                }
            }

            let audioPlayerPlayDirective: any = { type: "AudioPlayer.Play" }
            let audioPlayerStopDirective: any = { type: "AudioPlayer.Stop" }
            let audioPlayerClearQueueDirective: any = { type: "AudioPlayer.ClearQueue" }
            if (response.ACTION.audio && response.ACTION.audioPlayer) {
                let audioPlayerType = response.DATA.audioData.id || "stop"
                switch (audioPlayerType) {
                    case "playAudio":
                    case "resume":
                    case "nearlyFinished":
                    case "touchPlay": //add shoudlEndSession as true
                        // respBuilder.addAudioPlayerPlayDirective(response.DATA.audioData.behavior || "REPLACE_ALL", response.DATA.audioData.url || "", response.DATA.audioData.token || "", response.DATA.audioData.value || 0, response.DATA.audioData.prevToken || "", response.DATA.audioData.mediaData || {});
                        audioPlayerPlayDirective["playBehavior"] = response.DATA.audioData.behavior || "REPLACE_ALL"
                        let stream: any = {}
                        stream["url"] = response.DATA.audioData.url || ""
                        stream["token"] = response.DATA.audioData.token || ""
                        stream["offsetInMilliseconds"] = response.DATA.audioData.value || 0
                        if (response.DATA.audioData.prevToken) stream["expectedPreviousToken"] = response.DATA.audioData.prevToken || ""
                        let metadata = response.DATA.audioData.mediaData || {}
                        let audioItem = { stream, metadata }
                        audioPlayerPlayDirective["audioItem"] = audioItem || {}
                        directives.push(audioPlayerPlayDirective)
                        break;
                    case 'started':
                        // respBuilder.addAudioPlayerClearQueueDirective("CLEAR_ENQUEUED")
                        audioPlayerClearQueueDirective["clearBehavior"] = "CLEAR_ENQUEUED"
                        directives.push(audioPlayerClearQueueDirective)
                        break;
                    case "end": //send shoudEndSesion as true
                    case "pause":
                        directives.push(audioPlayerStopDirective)
                        break;
                    case "audioStopped":
                        break;
                    case "cancel": //send shoudEndSesion as true
                        directives.push(audioPlayerClearQueueDirective)
                        directives.push(audioPlayerStopDirective)
                        break;
                    case "clearQueue":
                        // respBuilder.addAudioPlayerClearQueueDirective("CLEAR_ALL").addAudioPlayerStopDirective();
                        audioPlayerClearQueueDirective["clearBehavior"] = response.DATA.audioData.behavior || "CLEAR_ALL"
                        directives.push(audioPlayerClearQueueDirective)
                        directives.push(audioPlayerStopDirective)
                        break;
                }
            }


            if (response.DATA.directives && response.DATA.directives.length > 0) {
                // directives = [...directives, ...response.DATA.directives]
                directives.push(...response.DATA.directives)
            }

            if (response.ACTION.clearDynamicEntity) {
                let clearDynamicEntitiesDirective = {
                    type: 'Dialog.UpdateDynamicEntities',
                    updateBehavior: 'CLEAR'
                }
                directives.push(clearDynamicEntitiesDirective)
                // console.log('CLEARING DYNAMIC ENTITY')
            }

            if (response.ACTION.dynamicEntity) {
                // console.log("DYNAMIC ENTITY PRESENT")
                let dynamicEntity = {
                    type: 'Dialog.UpdateDynamicEntities',
                    updateBehavior: 'REPLACE',
                    types: response.DATA.dynamicEntitiesData
                }
                directives.push(dynamicEntity)
                // console.log("DIRECTIVE : " + JSON.stringify(directives))
            }

            // if (response.OBJS && response.OBJS.HTMLEvent) {
            //     directives.push({
            //         type: response.OBJS.HTMLEvent.type,
            //         data: response.OBJS.HTMLEvent.data ? response.OBJS.HTMLEvent.data : {},
            //         request: {
            //             uri: response.OBJS.HTMLEvent.htmlUri || "",
            //             method: "GET",
            //             headers: response.OBJS.HTMLEvent.headers || {},
            //         },
            //         configuration: {
            //             timeoutInSeconds: 300
            //         },
            //         message: response.OBJS.HTMLEvent.message || {}
            //     })
            // }

            if (!_.isEmpty(outputSpeech)) _resp.response["outputSpeech"] = outputSpeech
            if (!_.isEmpty(card)) _resp.response["card"] = card
            if (!_.isEmpty(reprompt)) _resp.response["reprompt"] = reprompt
            if (directives.length > 0) _resp.response["directives"] = directives

            //set sessionData
            if (response.ACTION.sessionAttributes) {
                _resp["sessionAttributes"] = response.OBJS.sessionAttributes || {}
            }

        } catch (e) {
            console.log("ERROR: " + e)
        } finally {
            console.log("RESPONSE: " + JSON.stringify(_resp))
            return _resp
        }
    }
}


export async function getTemplate(data: any, type: string): Promise<any> {

    let result: any = {
        TYPE: type,
        TOKEN: data["TOKEN"],
    }

    return new Promise((resolve, reject) => {
        if (data["DOCUMENT"]) {
            result["DOCUMENT"] = data["DOCUMENT"]
            resolve(result)
        } else {
            _cacheClient.getObject(data["PATH"] || "", GenericModel, (err: any, template: GenericModel) => {
                if (err) reject(err)
                else {
                    result["DOCUMENT"] = template
                    resolve(result)
                }
            })
        }
    })

}
export { postProcessing };

// Expected event object
// let event = {
//   actions: {
//       APLA: true
//     prompt: true,
//       repromtpt: true
//   },
//   objs: {
//       sessionData: {},
//       aplDoc: {},
//       sendEvent: {
//           token: "",
//           arguments: []
//       },
//       sendConnectionData: {
//           id: "",
//           custom_task_name: "",
//           type: "",
//           payload: "{}"
//       },
//       taskData: {
//           code: 200,
//           message: "",
//           payload: "[]"
//       },
//       cardData: {
//           type: "Simple",
//           title: "",
//           content: "",
//           smallImageUrl: "",
//           largeImageUrl: "",
//           permissions: []
//       }

//   },
//   data: {
//       promptSpeech: "",
//       repromptSpeech: "",
//       background: {
//           url: "",
//           opacity: ""
//       },
//       offset_data: {

//       },
//       mediaData: [
//           {
//               compId: "",
//               command: "",
//               token: "",
//               value: 1
//           }
//       ],
//       audioData: {
//           id: "playAudio",
//           behavior: "",
//           url: "",
//           value: 1,
//           token: "",
//           metaData: {},
//           prevToken: ""
//       },
//       assets: {
//           //images urls
//           //offsets
//       },
//       textContent: {
//           primaryText: ""
//       },
//       lists: {
//           pay: [
//               {
//                   name: "Hello"
//               }
//           ]
//       }
//   }
// }