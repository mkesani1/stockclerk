import React from 'react';
import { Link } from 'react-router-dom';

export const Terms: React.FC = () => {
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
        <h1 className="text-3xl font-bold text-text mb-2">Terms of Service</h1>
        <p className="text-text-muted mb-8">Last updated: February 2026</p>

        <div className="prose prose-bronze max-w-none space-y-6 text-text">
          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">1. Agreement to Terms</h2>
            <p className="text-text-muted leading-relaxed">
              By accessing or using StockClerk ("the Service"), operated by StockClerk Ltd ("we", "us", "our"),
              you agree to be bound by these Terms of Service. If you do not agree, you may not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">2. Description of Service</h2>
            <p className="text-text-muted leading-relaxed">
              StockClerk provides AI-powered inventory synchronisation software for multi-channel retail businesses.
              The Service connects your point-of-sale systems, e-commerce platforms, and delivery marketplaces to
              keep stock levels in sync automatically.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">3. Account Registration</h2>
            <p className="text-text-muted leading-relaxed">
              You must provide accurate and complete information when creating an account. You are responsible for
              maintaining the security of your account credentials. You must be at least 18 years old and have the
              authority to bind your business to these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">4. Free Trial and Billing</h2>
            <p className="text-text-muted leading-relaxed">
              New accounts receive a 14-day free trial. After the trial period, continued use requires a paid
              subscription. All prices are in GBP and exclusive of VAT where applicable. You may cancel your
              subscription at any time; access continues until the end of your current billing period.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">5. Acceptable Use</h2>
            <p className="text-text-muted leading-relaxed">
              You agree not to misuse the Service, including attempting to access systems without authorisation,
              interfering with other users, or using the Service for any unlawful purpose. We reserve the right
              to suspend accounts that violate these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">6. Data and Integrations</h2>
            <p className="text-text-muted leading-relaxed">
              The Service accesses your inventory data through authorised API connections to your sales channels.
              You retain ownership of all your data. We process your data solely to provide the Service as described
              in our Privacy Policy. You are responsible for maintaining valid API credentials for your connected channels.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">7. Service Availability</h2>
            <p className="text-text-muted leading-relaxed">
              We aim to provide 99.9% uptime but do not guarantee uninterrupted service. We are not liable for
              any losses arising from service downtime, synchronisation delays, or third-party platform outages
              that affect our integrations.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">8. Limitation of Liability</h2>
            <p className="text-text-muted leading-relaxed">
              To the maximum extent permitted by law, StockClerk shall not be liable for any indirect, incidental,
              or consequential damages, including lost profits or lost sales, arising from your use of the Service.
              Our total liability shall not exceed the amount you paid us in the 12 months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">9. Changes to Terms</h2>
            <p className="text-text-muted leading-relaxed">
              We may update these terms from time to time. We will notify you of material changes via email or
              through the Service. Continued use after changes take effect constitutes acceptance of the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">10. Governing Law</h2>
            <p className="text-text-muted leading-relaxed">
              These terms are governed by the laws of England and Wales. Any disputes shall be subject to the
              exclusive jurisdiction of the courts of England and Wales.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-text mt-8 mb-3">Contact</h2>
            <p className="text-text-muted leading-relaxed">
              If you have any questions about these Terms, please contact us at{' '}
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

export default Terms;
