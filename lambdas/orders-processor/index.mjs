import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const dynamo = new DynamoDBClient({});
const sns = new SNSClient({});

const SNS_TOPIC_ARN = "arn:aws:sns:eu-north-1:430165813080:order-notifications-uo295454";

export const handler = async (event) => {
  for (const record of event.Records) {
    const body = JSON.parse(record.body);

    const detail = typeof body.detail === "string"
      ? JSON.parse(body.detail)
      : (body.detail || body.Detail || {});

    const orderId = detail.orderId;

    await dynamo.send(new UpdateItemCommand({
      TableName: "orders-uo295454",
      Key: { Id: { S: orderId } },
      UpdateExpression: "SET #s = :status",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":status": { S: "PROCESSED" } }
    }));

    await sns.send(new PublishCommand({
      TopicArn: SNS_TOPIC_ARN,
      Subject: "Pedido procesado",
      Message: `Tu pedido ${orderId} ha sido procesado con éxito.`
    }));
  }
};