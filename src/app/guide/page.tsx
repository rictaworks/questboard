import {getTranslations} from 'next-intl/server';

// 利用者向けの使い方ページ（issue #209）。認証不要・日本語のみの静的コンテンツで、
// 文言はすべて ja.json（Guide セクション）から描画する。HTML は解釈しない。
// 操作仕様を変えたときは、ボード画面のヒント（BoardCanvas.hint*）と本ページの
// 記述がずれないように両方を更新すること。
export default async function GuidePage() {
  const t = await getTranslations('Guide');

  return (
    <main className="home-shell legal-page">
      <article className="hero-card legal-card">
        <h1 className="home-title">{t('title')}</h1>
        <p className="hero-copy">{t('intro')}</p>

        <section className="legal-section" id="board">
          <h2>{t('boardHeading')}</h2>
          <p>{t('boardCreate')}</p>
          <p>{t('boardShare')}</p>
          <p>{t('boardRoles')}</p>
        </section>

        <section className="legal-section" id="create">
          <h2>{t('createHeading')}</h2>
          <p>{t('createDouble')}</p>
          <p>{t('createRadial')}</p>
        </section>

        <section className="legal-section" id="text">
          <h2>{t('textHeading')}</h2>
          <p>{t('textEdit')}</p>
        </section>

        <section className="legal-section" id="handles">
          <h2>{t('handleHeading')}</h2>
          <p>{t('handleList')}</p>
        </section>

        <section className="legal-section" id="shape">
          <h2>{t('shapeHeading')}</h2>
          <p>{t('shapeChange')}</p>
        </section>

        <section className="legal-section" id="delete">
          <h2>{t('deleteHeading')}</h2>
          <p>{t('deleteRestore')}</p>
        </section>

        <section className="legal-section" id="camera">
          <h2>{t('cameraHeading')}</h2>
          <p>{t('cameraPan')}</p>
          <p>{t('cameraZoom')}</p>
        </section>

        <section className="legal-section" id="quests">
          <h2>{t('questHeading')}</h2>
          <p>{t('questBody')}</p>
        </section>
      </article>
    </main>
  );
}
