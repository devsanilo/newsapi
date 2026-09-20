/**
 * Seed default pages — run once after table creation
 * Usage: node src/database/seedPages.js
 */
require("dotenv").config();
const Page = require("../models/Page");
const { sequelize } = require("../database/connection");

const defaultPages = [
  {
    slug: "about",
    title: "About Trenxi",
    meta_description:
      "Meet Trenxi — your calm, personalized space for trusted news, deeper context, and everyday clarity.",
    content: `
<section>
  <p><strong>Trenxi was built for people who want to stay informed without feeling overwhelmed.</strong></p>
  <p>Every day, headlines move fast. Our job is to slow the chaos down and help you focus on what matters. We bring together stories from trusted publishers, organize them into clear topics, and shape your feed around what you genuinely read and care about.</p>
  <p>Alongside trusted reporting from around the world, we also publish original pieces from our own editorial desk, so you get thoughtful context and fresh perspective in one place.</p>
</section>

<section>
  <h2>Our Mission</h2>
  <p>We believe quality journalism should be easy to reach, easy to understand, and easy to return to. No endless noise. No attention traps. Just meaningful stories, delivered in a cleaner and more personal experience.</p>
</section>

<section>
  <h2>What Makes Trenxi Different</h2>
  <ul>
    <li><strong>Personal, not chaotic:</strong> your For You feed learns from your reading habits and preferences.</li>
    <li><strong>Signal over noise:</strong> we prioritize clarity, relevance, and readability.</li>
    <li><strong>Real-time trends:</strong> see what the world is talking about right now.</li>
    <li><strong>AI summaries:</strong> get the key points quickly before diving deeper.</li>
    <li><strong>Save and organize:</strong> keep important stories in bookmark collections.</li>
    <li><strong>Reading streaks and badges:</strong> build a consistent habit and track progress.</li>
    <li><strong>Cross-device comfort:</strong> dark mode, push notifications, and offline-ready PWA support.</li>
  </ul>
</section>

<section>
  <h2>Our Editorial Approach</h2>
  <p>Trenxi does not replace publishers. We help you discover them. We prioritize credible sources, preserve links to original reporting, and keep transparency at the center of how stories are presented.</p>
</section>

<section>
  <h2>Built for Everyday Readers</h2>
  <p>Whether you check headlines in two minutes or explore long reads on weekends, Trenxi is designed to fit your rhythm, not hijack it.</p>
  <p><em>Stay informed. Stay curious. Stay in control.</em></p>
</section>
    `.trim(),
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    meta_description:
      "Trenxi Privacy Policy — how we collect, use, and protect your personal information.",
    content: `
<h2>1. Information We Collect</h2>
<p><strong>Account Information:</strong> When you create an account, we collect your name, email address, and password (stored securely using bcrypt hashing).</p>
<p><strong>Usage Data:</strong> We collect information about the articles you read, like, bookmark, and share to personalize your feed and improve our service.</p>
<p><strong>Device Information:</strong> We may collect basic device and browser information for analytics and push notification delivery.</p>

<h2>2. How We Use Your Information</h2>
<ul>
  <li>Personalizing your news feed and recommendations</li>
  <li>Tracking reading streaks and awarding badges</li>
  <li>Sending push notifications (if enabled)</li>
  <li>Delivering daily digest emails (if subscribed)</li>
  <li>Improving our service and fixing bugs</li>
</ul>

<h2>3. Data Sharing</h2>
<p>We do not sell, trade, or rent your personal information to third parties. We may share anonymized, aggregated data for analytics purposes.</p>

<h2>4. Data Security</h2>
<p>We implement industry-standard security measures including encrypted passwords, JWT authentication, and HTTPS to protect your data.</p>

<h2>5. Cookies &amp; Local Storage</h2>
<p>We use local storage to save your authentication token, theme preference, and reading history for a seamless experience.</p>
<p><strong>Advertising:</strong> We display advertisements served by Google AdSense, which uses cookies to serve ads based on your prior visits to this and other websites. You can opt out of personalized advertising by visiting <a href="https://adssettings.google.com" target="_blank" rel="noopener">adssettings.google.com</a> or <a href="https://www.aboutads.info" target="_blank" rel="noopener">www.aboutads.info</a>.</p>

<h2>6. Your Rights</h2>
<p>You can update or delete your account at any time from your Profile settings. You can also request a copy of your data by contacting us.</p>

<h2>7. Changes to This Policy</h2>
<p>We may update this privacy policy from time to time. We'll notify you of any significant changes through the app.</p>

<h2>8. Contact Us</h2>
<p>If you have questions about this privacy policy, please reach out via our <a href="/contact">Contact page</a>.</p>
    `.trim(),
  },
  {
    slug: "terms",
    title: "Terms of Service",
    meta_description:
      "Trenxi Terms of Service — the rules and guidelines governing your use of our platform.",
    content: `
<h2>1. Acceptance of Terms</h2>
<p>By accessing or using Trenxi, you agree to be bound by these Terms of Service. If you do not agree, please do not use our service.</p>

<h2>2. Description of Service</h2>
<p>Trenxi is a news discovery platform that brings together articles from various third-party sources alongside original content produced by our editorial team. Third-party articles link back to their original publishers.</p>

<h2>3. User Accounts</h2>
<p>You are responsible for maintaining the confidentiality of your account credentials. You must provide accurate information when creating an account and notify us immediately of any unauthorized use.</p>

<h2>4. Acceptable Use</h2>
<p>You agree not to:</p>
<ul>
  <li>Use the service for any unlawful purpose</li>
  <li>Attempt to gain unauthorized access to our systems</li>
  <li>Scrape, crawl, or harvest data from our platform</li>
  <li>Post spam, abusive, or harassing comments</li>
  <li>Impersonate another person or entity</li>
</ul>

<h2>5. Intellectual Property</h2>
<p>News articles displayed on Trenxi are the property of their respective publishers. The Trenxi platform, design, and features are the property of Trenxi and protected by applicable laws.</p>

<h2>6. Content Disclaimer</h2>
<p>We display content from third-party sources and are not responsible for the accuracy, completeness, or reliability of any news articles. We encourage users to verify information with original sources.</p>

<h2>7. Limitation of Liability</h2>
<p>Trenxi is provided "as is" without warranties of any kind. We shall not be liable for any indirect, incidental, or consequential damages arising from your use of the service.</p>

<h2>8. Termination</h2>
<p>We reserve the right to suspend or terminate your account at any time for violations of these terms. You may also delete your account at any time from your Profile settings.</p>

<h2>9. Changes to Terms</h2>
<p>We may modify these terms at any time. Continued use of the service after changes constitutes acceptance of the updated terms.</p>

<h2>10. Contact</h2>
<p>Questions about these terms? Visit our <a href="/contact">Contact page</a>.</p>
    `.trim(),
  },
  {
    slug: "contact",
    title: "Contact Us",
    meta_description:
      "Get in touch with the Trenxi team — we'd love to hear your feedback, questions, or bug reports.",
    content: `
<p>Have feedback, a question, or found a bug? We'd love to hear from you.</p>

<h2>📧 Email</h2>
<p>support@trenxi.com</p>

<h2>📍 Location</h2>
<p>San Francisco, CA</p>

<h2>💬 Get in Touch</h2>
<p>Use the contact form on this page to send us a message directly. We typically respond within 24 hours.</p>
    `.trim(),
  },
];

async function seed() {
  try {
    await sequelize.authenticate();
    await Page.sync({ alter: true });

    for (const page of defaultPages) {
      const [record, created] = await Page.findOrCreate({
        where: { slug: page.slug },
        defaults: page,
      });
      if (created) {
        console.log(`✅ Created page: ${page.slug}`);
      } else {
        console.log(`⏭️  Page already exists: ${page.slug}`);
      }
    }

    console.log("\n🎉 Page seeding complete!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Seed error:", err);
    process.exit(1);
  }
}

// Only run the CLI seeder when executed directly (`node src/database/seedPages.js`).
// Requiring this module must not touch the database or exit the process —
// connection.js reuses `defaultPages` for first-boot seeding.
if (require.main === module) {
  seed();
}

module.exports = { defaultPages, seed };
