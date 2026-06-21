# Production Docker запуск

## 1. Підготувати environment

```bash
cp .env.example .env
```

Замініть усі `CHANGE_ME_*` значення. Значення пароля PostgreSQL у `POSTGRES_PASSWORD` і в `DATABASE_URL` мають збігатися.

- Перед `docker compose ... up` задайте сильні незалежні `JWT_SECRET` і `JWT_REFRESH_SECRET` (див. README §21 — Production JWT secrets).

## 2. Зібрати та запустити

```bash
docker compose --env-file .env -f docker-compose.prod.yml build
docker compose --env-file .env -f docker-compose.prod.yml up -d
```

## 3. Перевірити стан

```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
docker compose --env-file .env -f docker-compose.prod.yml logs migrations
docker compose --env-file .env -f docker-compose.prod.yml logs api worker cron
```

## 4. Оновлення application image

```bash
docker compose --env-file .env -f docker-compose.prod.yml build
docker compose --env-file .env -f docker-compose.prod.yml run --rm migrations
docker compose --env-file .env -f docker-compose.prod.yml up -d --no-deps api worker cron
```

## 5. Зупинка

```bash
docker compose --env-file .env -f docker-compose.prod.yml down
```

Для видалення даних PostgreSQL і Redis додайте `-v`. У production цього зазвичай робити не слід.

## Важливо

- PostgreSQL і Redis не публікуються на host.
- API за замовчуванням доступний тільки на `127.0.0.1:3000`; зовні його слід відкривати через Nginx/Traefik.
- Міграції запускаються окремим compiled entrypoint як **one-shot deployment job** (не long-running sidecar) і не потребують `drizzle-kit` у runtime image.
- Production runner серіалізує паралельні запуски через PostgreSQL advisory lock: безпечно виконати `docker compose run --rm migrations`, поки інший migration job ще працює — другий процес почекає, потім завершиться успішно або з timeout помилки.
- Усі entrypoint використовують один immutable image.
- `.env` виключено з Docker build context через `.dockerignore`.
