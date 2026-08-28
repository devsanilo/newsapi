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
    title: "About Noozia",
    meta_description:
      "Learn about Noozia — the smart news aggregator that delivers curated stories from trusted sources worldwide.",
    content: `
<h2>⚡ What We Do</h2>
<p>We aggregate news from dozens of reputable sources, organize them by topic, and personalize your feed based on your reading habits. No algorithms designed to outrage — just the stories that matter to you.</p>

<h2>🎯 Our Mission</h2>
<p>To make staying informed effortless. We believe everyone deserves access to quality journalism without the noise, clickbait, or information overload that plagues most news platforms.</p>

<h2>🚀 Features</h2>
<ul>
  <li>Personalized "For You" feed powered by your reading preferences</li>
  <li>Real-time trending topics and articles</li>
  <li>AI-powered article summaries</li>
  <li>Reading streaks and gamification badges</li>
  <li>Dark mode for comfortable reading</li>
  <li>Bookmark collections to organize saved articles</li>
  <li>Push notifications for breaking news</li>
  <li>Works offline as a Progressive Web App</li>
</ul>
    `.trim(),
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    meta_description:
      "Noozia Privacy Policy — how we collect, use, and protect your personal information.",
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
      "Noozia Terms of Service — the rules and guidelines governing your use of our platform.",
    content: `
<h2>1. Acceptance of Terms</h2>
<p>By accessing or using Noozia, you agree to be bound by these Terms of Service. If you do not agree, please do not use our service.</p>

<h2>2. Description of Service</h2>
<p>Noozia is a news aggregation platform that collects and displays articles from various third-party sources. We do not create original news content. All articles link back to their original publishers.</p>

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
<p>News articles displayed on Noozia are the property of their respective publishers. The Noozia platform, design, and features are the property of Noozia and protected by applicable laws.</p>

<h2>6. Content Disclaimer</h2>
<p>We aggregate content from third-party sources and are not responsible for the accuracy, completeness, or reliability of any news articles. We encourage users to verify information with original sources.</p>

<h2>7. Limitation of Liability</h2>
<p>Noozia is provided "as is" without warranties of any kind. We shall not be liable for any indirect, incidental, or consequential damages arising from your use of the service.</p>

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
      "Get in touch with the Noozia team — we'd love to hear your feedback, questions, or bug reports.",
    content: `
<p>Have feedback, a question, or found a bug? We'd love to hear from you.</p>

<h2>📧 Email</h2>
<p>support@noozia.app</p>

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

seed();
