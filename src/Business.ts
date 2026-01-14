
import AWS from "aws-sdk"

const lambda = new AWS.Lambda()

export async function businessLogic(event: any) {
    const params: AWS.Lambda.InvocationRequest = {
        FunctionName: process.env.BUSINESS_LAMBDA || "",
        InvocationType: "RequestResponse",
        Payload: JSON.stringify(event.payload)
    }

    try {
        const response = await lambda.invoke(params).promise()
        // console.log("BusinessLogics : " + JSON.stringify(response))
        return response
    } catch (err) {
        console.error("Error @businessLogic : ")
        console.error(err)
    }
}