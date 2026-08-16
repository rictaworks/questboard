import {faCircleInfo} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import Link from 'next/link';
import {getTranslations} from 'next-intl/server';

export default async function SiteFooter() {
  const t = await getTranslations('Footer');

  return (
    <footer className="site-footer">
      <details className="site-footer-disclosure">
        <summary className="site-footer-trigger" aria-label={t('navLabel')} title={t('navLabel')}>
          <FontAwesomeIcon icon={faCircleInfo} />
        </summary>
        <div className="site-footer-panel">
          <nav aria-label={t('navLabel')}>
            <ul className="site-footer-links">
              <li>
                <Link href="/legal#privacy-policy">{t('privacyPolicy')}</Link>
              </li>
              <li>
                <Link href="/legal#terms">{t('termsOfUse')}</Link>
              </li>
              <li>
                <Link href="/legal#operator">{t('operatorInfo')}</Link>
              </li>
              <li>
                <Link href="/legal#contact">{t('contact')}</Link>
              </li>
            </ul>
          </nav>
          <p className="site-footer-note">{t('authoritativeLanguage')}</p>
          <p className="site-footer-copyright">{t('copyright')}</p>
        </div>
      </details>
    </footer>
  );
}
