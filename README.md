# Tienda Online — AWS Serverless

Práctica final del taller **Microservicios Serverless en AWS** (Talentuo × Next Digital).

Aplicación de gestión de pedidos construida íntegramente sobre servicios serverless de AWS, sin servidores que gestionar ni infraestructura que aprovisionar.

---

## Arquitectura

```
Usuario
  │
  ▼
Frontend (S3 Static Hosting)
  │
  ▼
API Gateway (HTTP API)
  ├── POST /orders ──────────► Lambda: orders-handler
  │                                 │
  │                          DynamoDB (orders)
  │                          EventBridge (event: OrderCreated)
  │                                 │
  │                                 ▼
  │                            SQS (orders-queue)
  │                                 │
  │                                 ▼
  │                          Lambda: orders-processor
  │                                 │
  │                          DynamoDB (update status → PROCESSED)
  │                          SNS ──► Email al usuario
  │
  └── GET /orders/{id} ──────► Lambda: orders-handler
                                     │
                                DynamoDB (read)
```

### Servicios utilizados

| Servicio | Rol |
|---|---|
| **S3** | Alojamiento del frontend estático |
| **API Gateway** | Exposición de los endpoints HTTP |
| **Lambda** | Lógica de negocio serverless |
| **DynamoDB** | Base de datos NoSQL de pedidos y rate limiting |
| **EventBridge** | Bus de eventos para desacoplar la creación del procesado |
| **SQS** | Cola de mensajes que activa el procesador |
| **SNS** | Notificación por email al procesar un pedido |

---

## Flujo de un pedido

1. El usuario rellena el formulario y pulsa **Crear pedido**
2. El frontend llama a `POST /orders` en API Gateway
3. `orders-handler` comprueba el rate limit por IP en DynamoDB
4. Si se permite, guarda el pedido en DynamoDB con estado `PENDING` y publica un evento `OrderCreated` en EventBridge
5. EventBridge enruta el evento a la cola SQS
6. SQS dispara `orders-processor`
7. `orders-processor` actualiza el estado a `PROCESSED` en DynamoDB y envía un email de confirmación via SNS
8. El usuario puede consultar el estado final con `GET /orders/{id}`

---

## Estructura del repositorio

```
.
├── frontend/
│   └── index.html              # Frontend estático desplegado en S3
├── lambdas/
│   ├── orders-handler/
│   │   └── index.mjs           # Lambda: crea pedidos y consulta estado
│   └── orders-processor/
│       └── index.mjs           # Lambda: procesa pedidos y envía email
└── README.md
```

---

## Infraestructura AWS

### Tablas DynamoDB

| Tabla | Partition Key | Descripción |
|---|---|---|
| `orders-uo295454` | `Id` (String) | Almacena los pedidos |
| `rate-limit-uo295454` | `Id` (String) | Contador de peticiones por IP |

### Lambdas

| Función | Runtime | Trigger | Descripción |
|---|---|---|---|
| `orders-handler-uo295454` | Node.js 20 | API Gateway | Crea pedidos (`POST /orders`) y consulta estado (`GET /orders/{id}`) |
| `orders-processor-uo295454` | Node.js 20 | SQS | Procesa pedidos y envía notificación por email |

### Otros recursos

- **API Gateway**: HTTP API con rutas `POST /orders` y `GET /orders/{id}`
- **EventBridge**: Regla `order-created-rule-uo295454` que filtra eventos `OrderCreated` de source `tienda.orders` y los enruta a SQS
- **SQS**: Cola estándar `orders-queue-uo295454` con DLQ (`orders-dlq-uo295454`) configurada con máximo 3 reintentos
- **SNS**: Topic `order-notifications-uo295454` con suscripción email

---

## Endpoints

### `POST /orders`

Crea un nuevo pedido.

**Body:**
```json
{
  "customer": "Fernando Alonso",
  "items": "Motor, Ruedas, Alerón"
}
```

**Respuesta 201:**
```json
{
  "id": "uuid-del-pedido",
  "status": "PENDING",
  "createdAt": "2026-04-10T10:00:00.000Z",
  "customer": "Fernando Alonso",
  "items": "Motor, Ruedas, Alerón"
}
```

**Respuesta 429** (rate limit superado):
```json
{
  "message": "Demasiados pedidos. Máximo 20 por hora por IP."
}
```

### `GET /orders/{id}`

Consulta el estado de un pedido.

**Respuesta 200:**
```json
{
  "id": "uuid-del-pedido",
  "status": "PROCESSED",
  "createdAt": "2026-04-10T10:00:00.000Z",
  "customer": "Fernando Alonso",
  "items": "Motor, Ruedas, Alerón"
}
```

**Respuesta 404:**
```json
{
  "message": "Pedido no encontrado"
}
```

---

## Rate Limiting

La API limita la creación de pedidos a **20 por IP cada hora**.

La implementación usa DynamoDB como almacén de contadores. Cada registro guarda la IP, el número de peticiones y el timestamp de inicio de la ventana. Cuando la ventana de una hora expira, el contador se resetea en la siguiente petición.

El header `X-RateLimit-Remaining` en la respuesta indica cuántos pedidos quedan disponibles en la ventana actual.

---

## Decisiones de diseño

**¿Por qué DynamoDB y no RDS?**
Los pedidos no requieren joins ni transacciones complejas. DynamoDB ofrece latencia en milisegundos, escala automáticamente y su modelo de coste encaja con el patrón serverless: se paga solo por lo que se usa.

**¿Por qué EventBridge entre la creación y el procesado?**
Desacopla ambas Lambdas. `orders-handler` no sabe ni le importa quién procesa el pedido. Si en el futuro hay que añadir más consumidores (analytics, notificaciones push, etc.), se añade una regla en EventBridge sin tocar el handler.

**¿Por qué SQS entre EventBridge y el procesador?**
Aporta resiliencia: si `orders-processor` falla, SQS retiene el mensaje y reintenta. La DLQ captura los mensajes que fallen repetidamente para poder inspeccionarlos sin perderlos.

---

## Autor

UO295454 — Taller Microservicios Serverless en AWS, Talentuo × Next Digital
