import { validateRequest } from "./src/Authentication"
import { businessLogic } from "./src/Business"
import { postProcess } from "./src/Postprocessing"
import { preProcess } from "./src/Preprocessing"

let handler = async (input: any): Promise<any> => {
    let response: any = {}
    try {
        console.log("INPUT : " + JSON.stringify(input))
        let authResp = await validateRequest(input)
        console.log("AUTHRESP : " + JSON.stringify(authResp))
        let preResp = await preProcess(authResp)
        console.log("PRERESP : " + JSON.stringify(preResp))
        let businessResp = await businessLogic(preResp)
        console.log("BUSINESSRESP : ", businessResp?.Payload)
        let postResp = await postProcess(businessResp)
        console.log("POSTRESP : ", postResp)

        response = {
            "statusCode": 200,
            "headers": {
                'Content-Type': 'application/json'
            },
            "body": JSON.stringify(postResp)
        }
    } catch (err) {
        console.error("Error @handler : ")
        console.error(err)
        response = {
            "statusCode": 500,
            "headers": {
                'Content-Type': 'application/json'
            },
            "body": JSON.stringify({
                "message": "Internal Server Error.",
            })
        }
    } finally {
        console.log("FINAL RESPONSE : ", response)
        return response
    }

}

export { handler }