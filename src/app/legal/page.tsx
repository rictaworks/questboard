import {getTranslations} from 'next-intl/server';

export default async function LegalPage() {
  const t = await getTranslations('Legal');

  return (
    <main className="home-shell legal-page">
      <article className="hero-card legal-card">
        <h1 className="home-title">{t('title')}</h1>
        <p className="hero-copy">{t('intro')}</p>
        <p className="legal-authoritative">{t('authoritativeLanguage')}</p>

        <section className="legal-section" id="privacy-policy">
          <h2>{t('privacyHeading')}</h2>
          <p>{t('privacyCollected')}</p>
          <p>{t('privacyCookies')}</p>
          <p>{t('privacyUse')}</p>
          <p>{t('privacySharing')}</p>
          <p>{t('privacyRetention')}</p>
          <p>{t('privacyDeletion')}</p>
        </section>

        <section className="legal-section" id="terms">
          <h2>{t('termsHeading')}</h2>
          <p>{t('termsUse')}</p>
          <p>{t('termsAvailability')}</p>
          <p>{t('termsIP')}</p>
        </section>

        <section className="legal-section" id="operator">
          <h2>{t('operatorHeading')}</h2>
          <p>{t('operatorName')}</p>
          <p>{t('operatorAddress')}</p>
        </section>

        <section className="legal-section" id="contact">
          <h2>{t('contactHeading')}</h2>
          <p>{t('contactBody')}</p>
          <p>
            <a href={`mailto:${t('contactEmail')}`}>{t('contactEmail')}</a>
          </p>
        </section>

        <section className="legal-section" id="billing">
          <h2>{t('billingHeading')}</h2>
          <p>{t('billingBody')}</p>
        </section>
      </article>
    </main>
  );
}
