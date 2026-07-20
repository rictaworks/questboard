import {faLanguage, faShieldHalved} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {getTranslations} from 'next-intl/server';

import {isDevelopmentEnvironment} from '@/lib/environment';

export default async function LocaleHomePage() {
  const t = await getTranslations('Home');
  const isDevelopmentAuthEnabled = isDevelopmentEnvironment();

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

      {isDevelopmentAuthEnabled ? (
        <aside className="dev-auth-banner" data-testid="development-auth-bypass">
          <FontAwesomeIcon icon={faShieldHalved} />
          <span>{t('developmentAuthBadge')}</span>
        </aside>
      ) : null}

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
    </main>
  );
}
