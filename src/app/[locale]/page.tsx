import {faLanguage} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {getTranslations} from 'next-intl/server';

import AuthPanel from '@/components/auth-panel';

export default async function LocaleHomePage() {
  const t = await getTranslations('Home');

  return (
    <main className="home-shell">
      <section className="hero-card">
        <p className="eyebrow">
          <FontAwesomeIcon icon={faLanguage} />
          <span>{t('eyebrow')}</span>
        </p>
        <h1>{t('headline')}</h1>
        <p className="hero-copy">{t('description')}</p>
        <div className="hero-actions">
          <a className="button button-primary" href="#design-tokens">
            {t('primaryAction')}
          </a>
          <a className="button button-secondary" href="#locales">
            {t('secondaryAction')}
          </a>
        </div>
      </section>

      <section className="grid" id="design-tokens">
        <article className="panel">
          <h2>{t('designTokensTitle')}</h2>
          <p>{t('designTokensDescription')}</p>
        </article>
        <article className="panel" id="locales">
          <h2>{t('localesTitle')}</h2>
          <p>{t('localesDescription')}</p>
        </article>
      </section>

      <section className="auth-section" aria-labelledby="auth-heading">
        <h2 id="auth-heading">{t('authSectionTitle')}</h2>
        <AuthPanel />
      </section>
    </main>
  );
}
