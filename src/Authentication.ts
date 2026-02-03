import { SkillRequestSignatureVerifier, TimestampVerifier } from 'ask-sdk-express-adapter';
import _ from "lodash";

interface AuthResponse {
    statusCode: number;
    body: string;
}

const validateRequest = async (event: any): Promise<AuthResponse> => {
    const headers = _.get(event, "headers", {});
    const body = _.get(event, "body", "");

    const certUrl = _.get(headers, "SignatureCertChainUrl");
    const signature = _.get(headers, "Signature");

    if (!certUrl || !signature) {
        console.log("Missing required headers for Alexa verification");
        return {
            statusCode: 403,
            body: "Forbidden: Missing required headers"
        };
    }

    try {
        // Ensure body is a string for signature verification
        let bodyString: string;
        let requestBody: any;

        if (typeof body === 'string') {
            // console.log('BODY IS STRING, LENGTH:', body.length);
            bodyString = body;
            try {
                requestBody = JSON.parse(body);
            } catch (parseError) {
                console.error('Failed to parse body as JSON:', parseError);
                console.error('BODY CONTENT:', body.substring(0, 200));
                throw new Error('Invalid JSON in request body');
            }
        } else if (typeof body === 'object' && body !== null) {
            // console.log('BODY IS OBJECT, CONVERTING TO STRING');
            // If body is already an object, convert it back to string for signature verification
            try {
                bodyString = JSON.stringify(body);
                // console.log('SUCCESSFULLY STRINGIFIED BODY, LENGTH:', bodyString.length);
                requestBody = body;
            } catch (stringifyError) {
                console.error('Failed to stringify body object:', stringifyError);
                console.error('BODY OBJECT:', body);
                throw new Error('Cannot stringify request body object');
            }
        } else {
            console.error('INVALID BODY TYPE:', typeof body, 'VALUE:', body);
            throw new Error('Invalid request body format');
        }

        // Verify request signature with string body
        // console.log('STARTING SIGNATURE VERIFICATION');
        const signatureVerifier = new SkillRequestSignatureVerifier();
        try {
            await signatureVerifier.verify(bodyString, headers);
            // console.log('SIGNATURE VERIFICATION SUCCESSFUL');
        } catch (sigError) {
            console.error('SIGNATURE VERIFICATION FAILED:', sigError);
            throw sigError;
        }

        // console.log('STARTING TIMESTAMP VERIFICATION');
        // Check the timestamp in the request
        const currentTime = new Date().toISOString();
        const requestTimestamp = requestBody.request?.timestamp;

        // if (requestTimestamp) {
        //     const timeDiff = (new Date().getTime() - new Date(requestTimestamp).getTime()) / 1000;
        //     console.log('TIME DIFFERENCE (seconds):', timeDiff);
        //     console.log('TIMESTAMP TOLERANCE: Usually 150 seconds');
        // }

        // The TimestampVerifier expects the raw JSON string of the Alexa request
        // We need to pass the original bodyString, not the parsed object
        const timestampVerifier = new TimestampVerifier();
        try {
            await timestampVerifier.verify(bodyString);
            // console.log('TIMESTAMP VERIFICATION SUCCESSFUL');
        } catch (timeError) {
            console.error('TIMESTAMP VERIFICATION FAILED:', timeError);
            console.log("Request should be within past 150 seconds")
            throw timeError;
        }

        // console.log("Both Signature and Timestamp verification successful");

        let resp = {
            pathParameters: event.pathParameters || {},
            body: body
        }

        return {
            statusCode: 200,
            body: JSON.stringify(resp)
        };
    } catch (err) {
        console.log("Request verification failed:", err);
        return {
            statusCode: 403,
            body: "Forbidden: Invalid request signature or timestamp"
        };
    }
}

export { validateRequest }