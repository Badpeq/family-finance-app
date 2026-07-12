# Guía de Automatización — Family Finance App

Este documento explica cómo conectar fuentes externas (Gmail, notificaciones del celular)
al endpoint de ingesta automática para capturar gastos sin escribirlos manualmente.

---

## Endpoint

```
POST https://tsdawpxiqqnesikcqlex.supabase.co/functions/v1/ingest-transaction
```

### Headers requeridos

```
Authorization: Bearer <TU_INGEST_TOKEN>
Content-Type: application/json
```

### Body

```json
{
  "source": "email",
  "raw_text": "texto completo del correo o notificación"
}
```

| Campo      | Tipo                          | Descripción                                       |
|------------|-------------------------------|---------------------------------------------------|
| `source`   | `"email"` ó `"notification"` | Origen del texto                                  |
| `raw_text` | `string`                      | Texto completo del correo o notificación push     |

### Respuesta exitosa (200)

```json
{
  "ok": true,
  "id": "uuid-de-la-transaccion",
  "monto": 45.50,
  "moneda": "PEN",
  "comercio": "WONG JOCKEY PLAZA",
  "tarjeta_id": "uuid-o-null",
  "estado": "PENDIENTE_REVISION"
}
```

### Respuesta con error de parsing (200 — no reintentar)

El endpoint siempre devuelve 200 para evitar que Make/n8n reintente infinitamente.
El error queda guardado en `log_errores_ingesta` para recuperación manual.

```json
{
  "ok": false,
  "error": "No se pudo identificar el monto — guardado en log",
  "logged": true
}
```

---

## Cómo generar tu token de ingesta

Desde la app: **Configuración → Automatización → Generar token**.

Internamente se inserta en la tabla `ingest_tokens`:

```sql
INSERT INTO ingest_tokens (token, user_id, descripcion)
VALUES (gen_random_uuid()::text, auth.uid(), 'Make - Gmail');
```

Puedes tener múltiples tokens (uno por servicio). Revocarlos no afecta a los otros.

---

## 1. Puente desde Gmail (vía Make / n8n)

### Escenario
Cada vez que tu banco te envía un correo de consumo, Make lo detecta
y reenvía el cuerpo del correo al endpoint.

### Configuración en Make (Integromat)

**Módulo 1 — Gmail Watch Emails**
```
Tipo:    Watch Emails
Carpeta: INBOX
Filtro:  from:(notificaciones@viabcp.com OR alertas@bbva.pe OR
               mensajes@interbank.pe OR notificaciones@scotiabank.com.pe)
```

**Módulo 2 — HTTP Make a request**
```
URL:     https://tsdawpxiqqnesikcqlex.supabase.co/functions/v1/ingest-transaction
Método:  POST
Headers:
  Authorization: Bearer {{TU_INGEST_TOKEN}}
  Content-Type:  application/json
Body (raw JSON):
  {
    "source": "email",
    "raw_text": "{{1.subject}}\n\n{{1.text}}"
  }
```

> **Tip:** Concatena el asunto + el cuerpo en `raw_text` para dar más contexto a la IA.

### Configuración en n8n

**Node 1 — Gmail Trigger**
- Event: Message Received
- Filters: `from:notificaciones@viabcp.com OR from:alertas@bbva.pe`

**Node 2 — HTTP Request**
```json
{
  "method": "POST",
  "url": "https://tsdawpxiqqnesikcqlex.supabase.co/functions/v1/ingest-transaction",
  "headers": {
    "Authorization": "Bearer {{TU_INGEST_TOKEN}}",
    "Content-Type": "application/json"
  },
  "body": {
    "source": "email",
    "raw_text": "={{ $json.subject }}\n\n={{ $json.textPlain }}"
  }
}
```

### Ejemplo de texto que procesa la IA (BCP)

```
Asunto: Consumo con Tarjeta Débito Visa - S/.45.50 - WONG JOCKEY PLAZA

BCP: Se realizó un consumo de S/. 45.50 con tu Tarjeta Débito Visa *1234
en el establecimiento WONG JOCKEY PLAZA el 12/07/2026.
Si no reconoces esta operación, llama al 311-9898.
```

**Resultado parseado:**
```json
{
  "monto": 45.50,
  "moneda": "PEN",
  "comercio": "WONG JOCKEY PLAZA",
  "ultimos_4_digitos": "1234",
  "tipo": "gasto"
}
```

---

## 2. Puente desde Notificaciones del Celular

### Opción A — MacroDroid (Android)

**Trigger:** Notificación recibida
- App: BCP, BBVA, Interbank, Scotiabank (seleccionar las que uses)
- Filtro de texto (opcional): contiene "consumo" o "compra" o "pago"

**Acción:** HTTP Request (POST)

```
URL:    https://tsdawpxiqqnesikcqlex.supabase.co/functions/v1/ingest-transaction
Método: POST
Headers:
  Authorization: Bearer {TU_INGEST_TOKEN}
  Content-Type:  application/json
Body:
  {
    "source": "notification",
    "raw_text": "{notification_title}\n{notification_text}"
  }
```

Variables MacroDroid disponibles:
- `{notification_title}` → título de la notificación
- `{notification_text}` → cuerpo de la notificación
- `{notification_app}` → nombre de la app (opcional, incluirlo ayuda a la IA)

### Opción B — Tasker (Android)

**Profile:** Notificación recibida
- App: com.viabcp.viamobile (BCP), com.bbva.nxt.android (BBVA), etc.

**Task:** HTTP Request POST
```
Método: POST
URL: https://tsdawpxiqqnesikcqlex.supabase.co/functions/v1/ingest-transaction
Headers:
  Content-Type: application/json
  Authorization: Bearer TU_INGEST_TOKEN
Body:
  {"source":"notification","raw_text":"%entitle\n%entext"}
```

Variables Tasker: `%entitle` (título), `%entext` (texto).

### Opción C — Shortcuts (iOS, Automations)

iOS no permite leer notificaciones de otras apps por seguridad.
**Alternativa recomendada para iOS:** usar el puente Gmail (opción 1).

Si usas banca online en Safari puedes crear un Shortcut que:
1. Recibe texto compartido (share sheet)
2. Hace una llamada HTTP al endpoint

### Ejemplo de notificación procesada (BBVA)

```
Título: BBVA Alerta
Texto:  Consumo S/75.00 *5678 METRO JAVIER PRADO 12/07/2026 20:15
```

**Resultado parseado:**
```json
{
  "monto": 75.00,
  "moneda": "PEN",
  "comercio": "METRO JAVIER PRADO",
  "ultimos_4_digitos": "5678",
  "tipo": "gasto"
}
```

---

## 3. Matching automático de tarjetas

Para que el sistema asigne el gasto a la tarjeta correcta en la app:

1. Abre **Cuentas → Tarjetas de Crédito**
2. Edita cada tarjeta y completa el campo **"Últimos 4 dígitos"**
3. El sistema buscará la tarjeta cuyo `ultimos_4` coincida con el número que menciona la notificación

Si no hay coincidencia, el gasto igual se registra (sin `tarjeta_id`) y lo puedes asignar desde la pantalla de revisión.

---

## 4. Revisar gastos pendientes

Los gastos capturados automáticamente aparecen con estado `PENDIENTE_REVISION`.

En la app: **Movimientos → Pendientes de revisión** (badge con contador).

Con un toque puedes:
- ✅ **Confirmar**: categorizar y marcar como PROCESADO
- ✏️ **Editar**: corregir monto, comercio o tarjeta antes de confirmar
- ❌ **Rechazar**: eliminar si es un gasto duplicado o no relevante

---

## 5. Tolerancia a fallos

| Escenario                                | Comportamiento                                              |
|------------------------------------------|-------------------------------------------------------------|
| IA no detecta monto                      | Guardado en `log_errores_ingesta`, respuesta `ok: false`    |
| Tarjeta no encontrada por ultimos_4      | Tx creada sin `tarjeta_id`, se puede asignar manualmente    |
| Error de red al llamar a Anthropic       | Guardado en `log_errores_ingesta`, respuesta `ok: false`    |
| Token inválido o revocado                | 401 Unauthorized (Make/n8n sí reintenta — revisa el token)  |
| Payload mal formado                      | 400 Bad Request (Make/n8n sí reintenta — revisa el payload) |
| Gasto duplicado (mismo texto, mismo día) | Se inserta igual — revisar desde pantalla de pendientes     |

> Los errores `ok: false` con `logged: true` devuelven HTTP 200 deliberadamente
> para que Make/n8n no reintenten en bucle. Revisa `log_errores_ingesta` en Supabase
> Dashboard → Table Editor para recuperar esos registros.

---

## 6. Bancos soportados (ejemplos de formatos)

| Banco        | Tipo notificación | Formato aproximado |
|--------------|-------------------|--------------------|
| BCP          | Push + Email      | `Consumo S/. XX.XX con Tarjeta *1234 en COMERCIO` |
| BBVA         | Push + Email      | `Consumo S/XX.XX *5678 COMERCIO DD/MM/YYYY HH:MM` |
| Interbank    | Push + Email      | `Realizaste un pago de S/XX.XX en COMERCIO con tarjeta terminada en 9012` |
| Scotiabank   | Push              | `Compra S/XX.XX - COMERCIO - Tarjeta *3456` |
| BanBif       | Email             | `Se registró un cargo de S/ XX.XX en tu tarjeta *7890` |
| Mibanco      | Push              | `Pago realizado por S/XX.XX a COMERCIO` |

La IA es flexible — si el formato cambia, sigue funcionando mientras el texto contenga monto y comercio.
