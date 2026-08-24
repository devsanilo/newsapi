/**
 * Redis Configuration for Bull Queue
 */
module.exports = {
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  },
  defaultJobOptions: {
    removeOnComplete: 100,  // Keep last 100 completed jobs
    removeOnFail: 50,       // Keep last 50 failed jobs
    attempts: parseInt(process.env.CRAWLER_MAX_RETRIES, 10) || 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
};
