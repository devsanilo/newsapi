# 📰 Noozia API

A production-ready **Noozia Crawler Service** built with Node.js, Express, Sequelize, and MySQL. Designed to power a Flutter mobile news app.

## 🎯 Features

- **RSS Feed Aggregation** — Fetches news from 10+ configurable RSS sources
- **HTML Scraping** — Cheerio (static) + Puppeteer (dynamic JS-rendered pages)
- **Deduplication** — SHA256 hash + UNIQUE constraints prevent duplicate articles
- **Full-Text Search** — MySQL FULLTEXT index on title & description
- **Trending Articles** — Based on recency and headline frequency
- **Queue System** — Bull + Redis for job processing with retry logic
- **Cron Scheduler** — Automatic crawling every 30 minutes
- **REST API** — Clean endpoints optimized for Flutter consumption
- **Tag Extraction** — Automatic keyword extraction from content
- **Language Detection** — Basic language detection for multilingual support

## 🧱 Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js (LTS) |
| Framework | Express.js |
| ORM | Sequelize |
| Database | MySQL (InnoDB, utf8mb4) |
| Queue | Bull + Redis |
| RSS Parser | rss-parser |
| Static Scraper | Cheerio |
| Dynamic Scraper | Puppeteer |
| Scheduler | node-cron |
| Logger | Winston |

## 📁 Project Structure

```
src/
├── config/
│   ├── database.js      # MySQL/Sequelize config
│   ├── redis.js         # Redis/Bull config
│   └── sources.js       # RSS feeds & scraper selectors
├── controllers/
│   ├── newsController.js
│   └── crawlerController.js
├── crawlers/
│   ├── rssCrawler.js    # RSS feed fetcher
│   └── htmlScraper.js   # Cheerio + Puppeteer scraper
├── database/
│   └── connection.js    # Sequelize connection & sync
├── jobs/
│   ├── queue.js         # Bull queue definitions
│   ├── worker.js        # Queue job processor
│   └── scheduler.js     # Cron scheduler
├── middleware/
│   ├── errorHandler.js  # Centralized error handling
│   └── rateLimiter.js   # API rate limiting
├── models/
│   ├── News.js          # News Sequelize model
│   └─��� index.js
├── routes/
│   ├── index.js
│   ├── newsRoutes.js
│   └── crawlerRoutes.js
├── services/
│   ├── newsService.js   # Business logic
│   └── crawlerService.js # Crawl orchestrator
├── utils/
│   ├── logger.js        # Winston logger
│   ├── hash.js          # SHA256 hashing
│   └── cleaner.js       # HTML cleaning & tag extraction
└── index.js             # App entry point
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** >= 18.0.0
- **MySQL** >= 8.0
- **Redis** (optional, for queue system)

### 1. Clone & Install

```bash
cd NEWSAPI
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your MySQL credentials:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=news_aggregator
DB_USER=root
DB_PASSWORD=your_password_here
```

### 3. Create MySQL Database

```sql
CREATE DATABASE IF NOT EXISTS news_aggregator
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

### 4. Start the Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

The server will:
1. Connect to MySQL
2. Create the `news` table with indexes
3. Start the Express API on port 3000
4. Begin the cron scheduler (crawls every 30 minutes)

### 5. Start the Worker (Optional)

If using Redis + Bull queues:

```bash
npm run worker
```

### 6. Trigger First Crawl

```bash
curl -X POST http://localhost:3000/api/crawler/trigger
```

## 🐳 Docker Deployment (Dokploy / Docker Compose)

The repo ships a `Dockerfile` and `docker-compose.yml` that run the **API**, the **crawler worker**, **MySQL 8**, and **Redis** together.

### Deploy to Dokploy

1. Connect your Dokploy application to this repository (deploy from Git).
2. Dokploy detects `docker-compose.yml` — it builds the image and starts all services.
3. Set these env vars in the Dokploy app UI (or a `.env` file):
   - `JWT_SECRET` — **required**, set a long random string
   - `MYSQL_USER`, `MYSQL_PASSWORD` — non-root database app user (default `noozia` / `noozia_pass`)
   - `MYSQL_ROOT_PASSWORD` — MySQL root password
   - `DB_NAME` — database name (default `news_aggregator`)
   - `REDIS_PASSWORD` — optional Redis password
   - `API_PORT` — public port to expose (default `3000`)
   - `CRON_SCHEDULE` — crawl schedule (default `*/30 * * * *`)
   - Optional: `FOOTBALL_DATA_API_KEY`, `OPENAI_API_KEY`, `SMTP_*`, `VIDEO_FEED_URLS`
4. Deploy. On first boot the API creates/seeds tables automatically (MySQL + Redis must be healthy first — handled via healthchecks).

### Run locally with Docker Compose

```bash
cp .env.example .env   # add JWT_SECRET + DB creds
docker compose up -d --build
```

Services:
- `api` → http://localhost:3000 (set `API_PORT` to change)
- `worker` → processes crawl/scrape jobs from the Bull queue
- `db` → MySQL 8 (persistent volume `db-data`)
- `redis` → Redis 7 (persistent volume `redis-data`)

> **Note:** `NODE_ENV=production` uses no DB SSL by default (compose MySQL). If you point the API at a managed DB requiring TLS, set `DB_SSL=true` (and `DB_SSL_CA` if needed).


## 📡 API Endpoints

### News

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/news` | Paginated news list |
| GET | `/api/news?category=technology` | Filter by category |
| GET | `/api/news?source=bbc` | Filter by source |
| GET | `/api/news?page=2&limit=10` | Pagination |
| GET | `/api/news/search?q=AI` | Full-text search |
| GET | `/api/news/trending` | Trending articles |
| GET | `/api/news/categories` | List categories |
| GET | `/api/news/sources` | List sources |
| GET | `/api/news/stats` | Article statistics |
| GET | `/api/news/:id` | Single article |

### Crawler Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/crawler/trigger` | Trigger immediate crawl |
| POST | `/api/crawler/scrape` | Scrape specific URL |
| GET | `/api/crawler/feeds` | List configured feeds |
| GET | `/api/crawler/status` | Queue status |

### Example Responses

**GET /api/news?category=technology&limit=2**
```json
{
  "success": true,
  "data": [
    {
      "id": "a1b2c3d4-...",
      "title": "AI Revolution in 2024",
      "description": "Summary of the article...",
      "content": "Cleaned article content...",
      "image_url": "https://...",
      "source": "techcrunch",
      "category": "technology",
      "url": "https://techcrunch.com/...",
      "tags": ["artificial", "intelligence", "technology"],
      "language": "en",
      "published_at": "2024-01-15T10:30:00.000Z",
      "created_at": "2024-01-15T10:35:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 2,
    "total": 150,
    "totalPages": 75,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## 🗄️ Database Schema

```sql
CREATE TABLE news (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  content MEDIUMTEXT,
  image_url VARCHAR(1000),
  source VARCHAR(100),
  category VARCHAR(100),
  url VARCHAR(1000) UNIQUE,
  hash VARCHAR(64) UNIQUE,
  tags JSON,
  language VARCHAR(10) DEFAULT 'en',
  published_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_category (category),
  INDEX idx_source (source),
  INDEX idx_published_at (published_at DESC),
  INDEX idx_language (language),
  INDEX idx_created_at (created_at DESC),
  FULLTEXT INDEX ft_title_description (title, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## ⚙️ Configuration

### Adding New RSS Feeds

Edit `src/config/sources.js`:

```javascript
{
  name: 'Your Source',
  source: 'yoursource',
  category: 'technology',
  url: 'https://yoursource.com/rss',
  language: 'en',
}
```

### Adding New Scraper Configs

```javascript
yoursource: {
  source: 'YourSource',
  baseUrl: 'https://yoursource.com',
  titleSelector: 'h1',
  contentSelector: 'article p',
  imageSelector: "meta[property='og:image']",
  imageAttr: 'content',
  dynamic: false, // true for JS-rendered pages
}
```

## 📋 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment |
| `DB_HOST` | 127.0.0.1 | MySQL host |
| `DB_PORT` | 3306 | MySQL port |
| `DB_NAME` | news_aggregator | Database name |
| `DB_USER` | root | MySQL user |
| `DB_PASSWORD` | - | MySQL password |
| `REDIS_HOST` | 127.0.0.1 | Redis host |
| `REDIS_PORT` | 6379 | Redis port |
| `CRAWLER_CONCURRENCY` | 3 | Concurrent crawl jobs |
| `CRON_SCHEDULE` | */30 * * * * | Crawl schedule |
| `API_RATE_LIMIT_MAX` | 100 | Max API requests per window |

## ⚠️ Important Notes

- **Copyright**: Only article summaries are stored, not full copyrighted content
- **Source URLs**: Always included for attribution
- **Rate Limiting**: Built-in for both API and crawlers
- **Redis Optional**: The system works without Redis (direct crawling via cron)

## 📄 License

MIT
