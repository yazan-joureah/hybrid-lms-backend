# Hybrid LMS — Backend

منصة تعليمية هجينة (Hybrid LMS) — الواجهة الخلفية. جزء من مشروع تخرج BPR601 — S25.

**المسؤول عن هذه الوحدة:** يزن جوريه — 174681 (Backend + Cybersecurity Lead)

---

## المكدس التقني (Tech Stack)

| المكوّن | الأداة | الترخيص |
|---|---|---|
| Runtime | Node.js 22 LTS | مفتوح المصدر |
| Framework | Express.js | مفتوح المصدر |
| Database | MongoDB 8.x | مفتوح المصدر |
| Cache/Session | Redis 7 | مفتوح المصدر |
| DB Browser (Dev only) | mongo-express | مفتوح المصدر (MIT) |
| Password Hashing | Argon2id (@node-rs/argon2) | مفتوح المصدر |
| Validation | Zod | مفتوح المصدر |
| Testing | Jest + Supertest + fast-check | مفتوح المصدر |

جميع الأدوات المستخدمة في هذا المشروع مجانية ومفتوحة المصدر — لا خدمات مدفوعة.

---

## البدء السريع (Getting Started)

### المتطلبات
- Node.js ≥ 22
- Docker Desktop (لتشغيل MongoDB و Redis محلياً)

### خطوات التشغيل

```bash
# 1. تثبيت الحزم
npm install

# 2. نسخ ملف البيئة وتعديله
cp .env.example .env

# 3. تشغيل قواعد البيانات محلياً
docker compose up -d

# 4. تشغيل الخادم في وضع التطوير
npm run dev
```

الخادم يعمل الآن على: `http://localhost:3000/api/v1/health`

**تصفح قاعدة البيانات بصرياً (اختياري):** بعد `docker compose up -d`، افتح `http://localhost:8081` (مستخدم: `admin` / كلمة مرور: `local_dev_only` — أداة تطوير محلية فقط، لا تُنشَر أبداً في الإنتاج).

---

## استراتيجية الاختبار (Testing Strategy)

الاختبارات تتصل بـ MongoDB و Redis **حقيقيَّين** — عبر `docker-compose` محلياً، وعبر `services:` في GitHub Actions أثناء CI (راجع `.github/workflows/ci.yml`). هذا يعطي دقة أعلى من محاكاة في الذاكرة، ويتجنّب الحاجة لتحميل ملفات تنفيذية إضافية (تفادياً لتضخيم `node_modules` دون داعٍ). استخدم قاعدة بيانات منفصلة للاختبار (`hybrid_lms_test`) لتفادي تلويث بيانات التطوير.

---

## الأوامر المتاحة

| الأمر | الوظيفة |
|---|---|
| `npm run dev` | تشغيل الخادم مع Hot Reload |
| `npm test` | تشغيل الاختبارات |
| `npm run test:coverage` | الاختبارات مع تقرير التغطية |
| `npm run lint` | فحص جودة وأمان الكود (ESLint + eslint-plugin-security) |
| `npm run format` | تنسيق الكود (Prettier) |

---

## هيكل المشروع (MVCS Architecture)

```
src/
├── config/       إعدادات البيئة، الاتصال بقاعدة البيانات و Redis
├── controllers/  استقبال الطلبات وإرسال الردود فقط (لا منطق أعمال هنا)
├── services/     منطق الأعمال الفعلي (Business Logic)
├── models/       مخططات Mongoose (مطابقة لـ Module_DB_Design_Specification_v1.3)
├── middleware/    JWT auth, validation, rate limiting, error handling
├── routes/       تعريف الـ Endpoints (مطابقة لـ REST_API_Contract_v1.2)
├── validators/   مخططات Zod للتحقق من المدخلات (FR-31)
├── utils/        دوال مساعدة (JWT, تشفير, logger)
└── jobs/         مهام مجدولة (Cron — حذف الحسابات المنتهية، إلخ)
```

---

## الأمان (Security — DevSecOps)

هذا المشروع يتبع منهجية Shift-Left Security:

- **قبل الـ Commit:** Husky + Gitleaks (فحص تسريب الأسرار محلياً)
- **في الـ CI:** ESLint Security Rules + npm audit + Gitleaks + Semgrep (OWASP Top 10 Ruleset) + CodeQL
- **التبعيات:** Dependabot (تحديث أسبوعي تلقائي)

راجع `docs/` للوثائق الأمنية الكاملة (Secure Coding Standards, Security Design Addendum).

---

## الوثائق المرجعية

ملفات التصميم الكاملة موجودة في `docs/`:
- `Module_DB_Design_Specification_v1.3.docx` — تصميم قاعدة البيانات
- `REST_API_Contract_v1.2_Groups1-4.docx` — عقد الـ API
- `AUTH_Wireframes_v1.2.html` — واجهات المستخدم التفاعلية

---

## استراتيجية الفروع (Branching)

```
main                                  ← محمي، عبر Pull Request فقط
  └── feature/AUTH-BE-01-registration
  └── fix/AUTH-BE-03-token-bug
```

نمط التسمية: `[MODULE]-[BE/FE]-[NN]` (مطابق لـ GitHub Projects Kanban).
