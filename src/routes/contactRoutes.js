/**
 * Contact Routes — public contact form
 *
 * Its own module rather than being bolted onto an existing router so the
 * limiter applies to exactly one route.
 */
const { Router } = require("express");
const contact = require("../controllers/contactController");
const { contactLimiter } = require("../middleware/rateLimiter");

const router = Router();

// Public and unauthenticated on purpose: someone reporting a broken page or a
// legal concern should not have to create an account to be heard.
router.post("/", contactLimiter, contact.submit);

module.exports = router;
