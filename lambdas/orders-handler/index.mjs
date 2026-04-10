import { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { randomUUID } from "crypto";

const dynamo = new DynamoDBClient({});
const eventbridge = new EventBridgeClient({});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
  "Content-Type": "application/json"
};

async function checkRateLimit(dynamo, ip) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - 3600; // última hora

  let item;
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: "rate-limit-uo295454",
      Key: { ip: { S: ip } }
    }));
    item = result.Item;
  } catch {
    item = null;
  }

  // Si no existe o la ventana expiró, crear/resetear
  if (!item || parseInt(item.windowStart.N) < windowStart) {
    await dynamo.send(new PutItemCommand({
      TableName: "rate-limit-uo295454",
      Item: {
        ip:          { S: ip },
        count:       { N: "1" },
        windowStart: { N: String(now) }
      }
    }));
    return { allowed: true, remaining: 19 };
  }

  const count = parseInt(item.count.N);

  if (count >= 20) {
    return { allowed: false, remaining: 0 };
  }

  // Incrementar contador
  await dynamo.send(new UpdateItemCommand({
    TableName: "rate-limit-uo295454",
    Key: { ip: { S: ip } },
    UpdateExpression: "SET #c = #c + :inc",
    ExpressionAttributeNames: { "#c": "count" },
    ExpressionAttributeValues: { ":inc": { N: "1" } }
  }));

  return { allowed: true, remaining: 19 - count };
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path = event.rawPath || event.path;

  if (method === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({})
    };
  }

  // GET /orders/{id}
  if (method === "GET" && path.startsWith("/orders/")) {
    const id = path.split("/orders/")[1];

    const result = await dynamo.send(new GetItemCommand({
      TableName: "orders-uo295454",
      Key: { Id: { S: id } }
    }));

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ message: "Pedido no encontrado" })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        id:        result.Item.Id.S,
        status:    result.Item.status.S,
        createdAt: result.Item.createdAt.S,
        customer:  result.Item.customer?.S || "—",  
        items:     result.Item.items?.S || "—"       
      })
    };
  }

  // POST /orders
  if (method === "POST" && path === "/orders") {
    const ip = event.requestContext?.http?.sourceIp
          || event.requestContext?.identity?.sourceIp
          || "unknown";

    const { allowed, remaining } = await checkRateLimit(dynamo, ip);

    if (!allowed) {
      return {
        statusCode: 429,
        headers: { "Retry-After": "3600" },
        body: JSON.stringify({
          message: "Demasiados pedidos. Máximo 20 por hora por IP."
        })
      };
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    
    // Leer customer e items del body
    const bodyParsed = JSON.parse(event.body || "{}");
    const customer = bodyParsed.customer || "Anónimo";
    const items = bodyParsed.items || "";
  
    await dynamo.send(new PutItemCommand({
      TableName: "orders-uo295454",
      Item: {
        Id:        { S: id },
        status:    { S: "PENDING" },
        createdAt: { S: createdAt },
        customer:  { S: customer }, 
        items:     { S: items }      
      }
    }));

    await eventbridge.send(new PutEventsCommand({
      Entries: [{
        Source: "tienda.orders",
        DetailType: "OrderCreated",
        Detail: JSON.stringify({ orderId: id }),
        EventBusName: "default"
      }]
    }));

    return {
      statusCode: 201,
      headers: { "X-RateLimit-Remaining": String(remaining) },
      body: JSON.stringify({ id, status: "PENDING", createdAt, customer, items })
    };
  }

  return {
    statusCode: 400,
    headers: corsHeaders,
    body: JSON.stringify({ message: "Ruta no soportada" })
  };
};