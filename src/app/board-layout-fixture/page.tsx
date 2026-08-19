import {faChevronLeft, faCompress, faXmark} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {NextIntlClientProvider} from 'next-intl';
import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {clientMessages} from '@/i18n/client-messages';
import BoardUserMenu from '@/components/board-user-menu';
import {avatarInitial} from '@/lib/presence-avatar';
import {isDevelopmentEnvironment} from '@/lib/environment';

// モック準拠レイアウト（issue #192）の静的フィクスチャ。
// board-layout-fixture.test.mjs が実ブラウザでスクロール境界・固定ミニマップ・
// 常設サイドバーの実測を行うため、本物のロジック無しで同じ CSS 構造を再現する。
const QUEST_ITEMS = Array.from({length: 10}, (_, index) => index + 1);
const COMMENT_ITEMS = Array.from({length: 12}, (_, index) => index + 1);
const MINIMAP_DOTS = Array.from({length: 18}, (_, index) => index + 1);

function isLayoutFixtureEnabled(): boolean {
  return isDevelopmentEnvironment() || process.env.NEXT_PUBLIC_ENABLE_LAYOUT_FIXTURE === 'true';
}

export default async function BoardLayoutFixturePage() {
  if (!isLayoutFixtureEnabled()) {
    notFound();
  }

  const boardInviteT = await getTranslations('BoardInvite');
  const boardCanvasT = await getTranslations('BoardCanvas');
  const fixtureT = await getTranslations('BoardLayoutFixture');
  const messages = await clientMessages(['BoardCanvas']);

  return (
    <main className="home-shell">
      <NextIntlClientProvider messages={messages}>
        <div className="board-join-success" role="status">
          <div className="board-join-success-body">
            <strong>{boardInviteT('successHeading')}</strong>
            <span>{boardInviteT('successDescription', {title: fixtureT('title'), role: boardInviteT('editorRole')})}</span>
          </div>
          <button aria-label={boardInviteT('successDismiss')} className="board-join-success-dismiss" type="button">
            {fixtureT('dismiss')}
          </button>
        </div>

        <section className="board-canvas-shell" aria-label={boardCanvasT('heading')}>
          <header className="board-top-bar">
            <span className="board-brand">
              <span aria-hidden="true" className="board-brand-mark" />
              <span className="board-brand-copy">
                <span className="board-brand-name">{boardCanvasT('brandName')}</span>
                <span className="board-brand-tagline">{boardCanvasT('brandTagline')}</span>
              </span>
            </span>
            <span aria-hidden="true" className="board-top-bar-divider" />
            <h1 className="board-top-bar-title">{fixtureT('title')}</h1>
            <span className="board-top-bar-spacer" />
            <div className="board-top-bar-group">
              <span className="board-top-bar-caption">{boardCanvasT('roleCaption')}</span>
              <span className="board-role-badge">{boardCanvasT('editorRole')}</span>
            </div>
            <div className="board-top-bar-group" role="group" aria-label={boardCanvasT('intensityLabel')}>
              <span className="board-top-bar-caption">{boardCanvasT('intensityLabel')}</span>
              <button aria-pressed className="board-seg-button" type="button">{boardCanvasT('intensityFull')}</button>
              <button aria-pressed={false} className="board-seg-button" type="button">{boardCanvasT('intensitySubtle')}</button>
              <button aria-pressed={false} className="board-seg-button" type="button">{boardCanvasT('intensityOff')}</button>
            </div>
            <div aria-label={boardCanvasT('participantsLabel')} className="board-avatar-stack" role="group">
              <span className="board-avatar board-avatar-color-0" title={fixtureT('userDisplayName')}>
                {avatarInitial(fixtureT('userDisplayName'))}
              </span>
              <span className="board-avatar board-avatar-overflow">
                {boardCanvasT('participantOverflow', {count: 2})}
              </span>
            </div>
            <div className="board-sync-status board-sync-status-connected" role="status">
              <span className="board-sync-status-dot" />
              <span>{boardCanvasT('connectionConnected')}</span>
            </div>
            <BoardUserMenu
              displayName={fixtureT('userDisplayName')}
              roleCode="editor"
            />
          </header>

          <div className="board-canvas-body">
            <aside aria-label={boardCanvasT('questHeading')} className="board-quest-sidebar" tabIndex={0}>
              <div className="board-quest-sidebar-heading">
                <div>
                  <p className="board-quest-eyebrow">{boardCanvasT('questEyebrow')}</p>
                  <h2>{boardCanvasT('questHeading')}</h2>
                </div>
                <button aria-label={boardCanvasT('questsCollapse')} className="board-quest-collapse" type="button">
                  <FontAwesomeIcon icon={faChevronLeft} />
                </button>
              </div>
              <ul className="board-quest-list">
                {QUEST_ITEMS.map((questIndex) => (
                  <li className="board-quest-item" key={questIndex}>
                    <div className="board-quest-item-title-row">
                      <span className="board-quest-item-title">{fixtureT('questTitle', {questIndex})}</span>
                      <span className="board-quest-item-state">{boardCanvasT('questStateInProgress')}</span>
                    </div>
                    <div className="board-quest-progress-track">
                      <div className="board-quest-progress-fill" style={{width: `${(questIndex % 2) * 50}%`}} />
                    </div>
                    <p className="board-quest-progress">{boardCanvasT('questProgress', {current: questIndex % 2, total: 1})}</p>
                    <div className="board-quest-actions">
                      <button className="board-quest-action-button" type="button">{boardCanvasT('questSkip')}</button>
                    </div>
                  </li>
                ))}
              </ul>
              <button className="board-quest-skip-all" type="button">{boardCanvasT('questSkipAll')}</button>
              <div className="board-quest-hints">
                <p>{boardCanvasT('hintCreate')}</p>
                <p>{boardCanvasT('hintRadial')}</p>
                <p>{boardCanvasT('hintPan')}</p>
                <p>{boardCanvasT('hintZoom')}</p>
              </div>
            </aside>

            <div className="board-stage-area">
              <div className="board-stage">
                <div className="board-scene" aria-label={boardCanvasT('canvasLabel')}>
                  <article
                    className="board-object board-object-sticky is-selected"
                    style={{left: '40px', top: '48px', width: '220px', height: '140px'}}
                  >
                    <div className="board-object-label">{fixtureT('sticky')}</div>
                    <span className="board-object-action board-object-action-comment">
                      <span className="board-object-action-count">{fixtureT('badgeCount')}</span>
                    </span>
                  </article>
                  <article
                    className="board-object board-object-shape"
                    style={{left: '380px', top: '168px', width: '180px', height: '120px'}}
                  >
                    <div className="board-object-label">{fixtureT('shape')}</div>
                  </article>
                  <article
                    className="board-object board-object-text"
                    style={{left: '-220px', top: '-140px', width: '200px', height: '120px'}}
                  >
                    <div className="board-object-label">{fixtureT('text')}</div>
                  </article>
                </div>
              </div>

              <div className="board-minimap-fixed" data-ui-chrome="true">
                <div className="board-minimap-header">
                  <span aria-hidden="true" className="board-minimap-caption">{boardCanvasT('minimapCaption')}</span>
                  <button aria-label={boardCanvasT('resetCamera')} className="board-minimap-reset" type="button">
                    <FontAwesomeIcon icon={faCompress} />
                  </button>
                </div>
                <button aria-label={boardCanvasT('minimapHeading')} className="board-minimap-surface" type="button">
                  {MINIMAP_DOTS.map((dotIndex) => (
                    <div
                      className={`board-minimap-dot${dotIndex === 1 ? ' is-selected' : ''}`}
                      key={dotIndex}
                      style={{
                        left: `${((dotIndex % 6) * 14 + 4) / 2.8}%`,
                        top: `${(Math.floor(dotIndex / 6) * 14 + 4) / 0.56}%`,
                        width: `${10 / 2.8}%`,
                        height: `${10 / 0.56}%`
                      }}
                    />
                  ))}
                  <div
                    className="board-minimap-viewport"
                    style={{
                      left: `${12 / 2.8}%`,
                      top: `${12 / 0.56}%`,
                      width: `${42 / 2.8}%`,
                      height: `${28 / 0.56}%`
                    }}
                  />
                </button>
              </div>
            </div>
          </div>

          <section className="board-canvas-panel-overlay board-details" aria-labelledby="details-heading" tabIndex={0}>
            <div className="board-details-header">
              <h2 id="details-heading">{boardCanvasT('selectionHeading')}</h2>
              <button aria-label={boardCanvasT('detailsClose')} className="board-details-close" type="button">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <p>{fixtureT('sticky')}</p>
            <div className="board-color-grid">
              <button className="board-color-swatch is-active" style={{backgroundColor: '#7b2fff'}} type="button" />
              <button className="board-color-swatch" style={{backgroundColor: '#22c55e'}} type="button" />
              <button className="board-color-swatch" style={{backgroundColor: '#f59e0b'}} type="button" />
              <button className="board-color-swatch" style={{backgroundColor: '#38bdf8'}} type="button" />
            </div>
            <section className="board-comments">
              <h3>{boardCanvasT('commentsHeading')}</h3>
              <ul className="board-comment-list">
                {COMMENT_ITEMS.map((commentIndex) => (
                  <li className="board-comment" key={commentIndex}>
                    <p className="board-comment-meta">
                      <strong>{fixtureT('commenter', {commentIndex})}</strong>
                      <span>{fixtureT('commentTime', {minute: String(commentIndex).padStart(2, '0')})}</span>
                    </p>
                    <p className="board-comment-body">
                      {fixtureT('commentBody', {commentIndex})}
                    </p>
                  </li>
                ))}
              </ul>
              <form className="board-comment-form">
                <textarea aria-label={boardCanvasT('commentBodyLabel')} placeholder={boardCanvasT('commentPlaceholder')} rows={4} />
                <div className="board-comment-actions">
                  <button className="button button-primary" type="button">{boardCanvasT('postComment')}</button>
                </div>
              </form>
            </section>
          </section>
        </section>
      </NextIntlClientProvider>
    </main>
  );
}
