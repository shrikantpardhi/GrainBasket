Backend Translation System (V1.0)

Vision

The backend is the single source of truth for all application text. Every app (Consumer, Store, Admin) receives translated content from APIs.

Supported Languages

Language| Code
English| en
Marathi| mr
Hindi| hi

Future: Gujarati ("gu"), Kannada ("kn"), Tamil ("ta"), Telugu ("te").

---

Database Tables

languages

Column| Type
id| UUID
code| VARCHAR
name| VARCHAR
active| BOOLEAN

translations

Column| Type
id| UUID
translation_key| VARCHAR
language_code| VARCHAR
translation_value| TEXT

Example:

translation_key| en| mr| hi
app.home| Home| मुख्यपृष्ठ| होम
order.accept| Accept Order| ऑर्डर स्वीकारा| ऑर्डर स्वीकार करें

---

API

"GET /translations?lang=mr"

Returns all Marathi translations as JSON.

Apps cache translations locally and refresh only when the backend version changes.

---

Product Translations

Product names and descriptions are also translated.

product_translations

Column| Type
product_id| UUID
language_code| VARCHAR
name| VARCHAR
description| TEXT

Example:

- Wheat Flour → Whole Wheat Flour / गव्हाचे पीठ / गेहूं का आटा.

---

Benefits

- One translation system for all apps.
- No app update needed for text changes.
- New languages added only in the backend.
- Cached on device for offline support.