import React from 'react';
import { Link } from 'react-router-dom';

export const Privacy: React.FC = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-bronze-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-white text-lg">{String.fromCodePoint(0x25C9)}</span>
            </div>
            <span className="font-bold text-text text-lg">StockClerk</span>
          </Link>
          <Link to="/register" className="text-primary hover:text-primary-dark text-sm font-medium">
            Back to Sign Up
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-text mb-2">Privacy Policy</h1>
        <p className="text-text-muted mb-8">Last updated: February 2026</p>

        <div className="prose prose-bronze max-w-none space-y-6 text-text">
          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">1. Who We Are</h2>
            <p className="text-text-muted leading-relaxed">
              StockClerk Ltd ("we", "us", "our") is the data controller for your personal data.
              We are committed to protecting your privacy and handling your data in accordance with
              the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">2. Data We Collect</h2>
            <p className="text-text-muted leading-relaxed">
              We collect the following categories of data: account information (name, email address,
              business name) provided during registration; inventory and product data accessed through
              your connected sales channels; usage data including how you interact with the Service;
              and technical data such as IP address, browser type, and device information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">3. How We Use Your Data</h2>
            <p className="text-text-muted leading-relaxed">
              We use your data to provide and maintain the Service, including synchronising inventory
              across your sales channels; to communicate with you about your account, billing, and
              service updates; to monitor and improve the performance and reliability of the Service;
              and to comply with legal obligations.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">4. Legal Basis for Processing</h2>
            <p className="text-text-muted leading-relaxed">
              We process your personal data on the following bases: performance of a contract (providing
              the Service you have subscribed to); legitimate interests (improving our Service and ensuring
              security); consent (where you have opted in to marketing communications); and legal obligation
              (compliance with applicable laws).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">5. Data Sharing</h2>
            <p className="text-text-muted leading-relaxed">
              We do not sell your personal data. We share data only with: third-party service providers who
              help us operate the Service (hosting, email, payment processing); your connected sales channels
              as necessary to perform inventory synchronisation; and authorities when required by law.
              All third-party processors are bound by data processing agreements.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">6. Data Security</h2>
            <p className="text-text-muted leading-relaxed">
              We implement appropriate technical and organisational measures to protect your data, including
              encryption in transit and at rest, access controls, and regular security reviews. API credentials
              for your connected channels are stored encrypted and are never shared.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">7. Data Retention</h2>
            <p className="text-text-muted leading-relaxed">
              We retain your account data for as long as your account is active. Synchronisation logs are
              retained for 90 days. If you close your account, we will delete your personal data within 30 days,
              except where we are required to retain it for legal or regulatory purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">8. Your Rights</h2>
            <p className="text-text-muted leading-relaxed">
              Under UK GDPR, you have the right to: access a copy of your personal data; rectify inaccurate data;
              erase your data (right to be forgotten); restrict processing; data portability; and object to processing.
              To exercise any of these rights, please contact us at hello@stockclerk.ai. We will respond within
              one month.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">9. Cookies</h2>
            <p className="text-text-muted leading-relaxed">
              We use essential cookies to keep you signed in and maintain your session. We do not use
              advertising or tracking cookies. You can manage cookie preferences through your browser settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">10. Changes to This Policy</h2>
            <p className="text-text-muted leading-relaxed">
              We may update this policy from time to time. We will notify you of material changes via email
              or through the Service. The date at the top of this page indicates when it was last updated.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">Contact</h2>
            <p className="text-text-muted leading-relaxed">
              For any questions about this Privacy Policy or your personal data, please contact us at{' '}
              <a href="mailto:hello@stockclerk.ai" className="text-primary hover:text-primary-dark">
                hello@stockclerk.ai
              </a>.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
};

export default Privacy;
