import {faArrowLeft, faNoteSticky, faShapes} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {NextIntlClientProvider} from 'next-intl';
import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {clientMessages} from '@/i18n/client-messages';
import BoardUserMenu from '@/components/board-user-menu';
import FixtureRail from '@/app/board-layout-fixture/fixture-rail';
import {isDevelopmentEnvironment} from '@/lib/environment';

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
          <div className="board-stage">
            <div className="board-scene" aria-label={boardCanvasT('canvasLabel')}>
              <article
                className="board-object board-object-sticky is-selected"
                style={{left: '40px', top: '48px', width: '220px', height: '140px'}}
              >
                <div className="board-object-label">{fixtureT('sticky')}</div>
                <span className="comment-badge">{fixtureT('badgeCount')}</span>
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

          <header className="board-canvas-title-bar">
            <span className="board-canvas-back-link">
              <FontAwesomeIcon icon={faArrowLeft} />
            </span>
            <h1>{fixtureT('title')}</h1>
            <div className="board-sync-status board-sync-status-connected" role="status">
              <span className="board-sync-status-dot" />
              <span>{boardCanvasT('connectionConnected')}</span>
            </div>
          </header>
          <div className="board-canvas-create-rail">
            <button aria-label={fixtureT('sticky')} className="board-canvas-rail-button" title={fixtureT('sticky')} type="button">
              <FontAwesomeIcon icon={faNoteSticky} />
            </button>
            <button aria-label={fixtureT('shape')} className="board-canvas-rail-button" title={fixtureT('shape')} type="button">
              <FontAwesomeIcon icon={faShapes} />
            </button>
          </div>

          <FixtureRail
            railLabel={boardCanvasT('heading')}
            questsLabel={boardCanvasT('questsToggle')}
            minimapLabel={boardCanvasT('minimapToggle')}
            detailsLabel={boardCanvasT('detailsToggle')}
            settingsLabel={boardCanvasT('settingsToggle')}
            userMenu={(
              <BoardUserMenu
                displayName={fixtureT('userDisplayName')}
                roleCode="editor"
              />
            )}
            questsPanel={(
              <section className="board-canvas-panel-overlay board-quest-panel" aria-labelledby="quest-panel-heading" tabIndex={0}>
                <div className="board-minimap-header">
                  <h2 id="quest-panel-heading">{boardCanvasT('questHeading')}</h2>
                  <span>{QUEST_ITEMS.length}</span>
                </div>
                <p className="board-quest-copy">{boardCanvasT('questDescription')}</p>
                <ul className="board-quest-list">
                  {QUEST_ITEMS.map((questIndex) => (
                    <li className="board-quest-item" key={questIndex}>
                      <div className="board-quest-item-header">
                        <strong>{fixtureT('questTitle', {questIndex})}</strong>
                        <span>{boardCanvasT('questStateInProgress')}</span>
                      </div>
                      <p className="board-quest-progress">{boardCanvasT('questProgress', {current: questIndex % 2, total: 1})}</p>
                      <div className="board-quest-actions">
                        <button className="button button-secondary" type="button">{boardCanvasT('questSkip')}</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            minimapPanel={(
              <section className="board-canvas-panel-overlay board-minimap" aria-labelledby="minimap-heading" tabIndex={0}>
                <div className="board-minimap-header">
                  <h2 id="minimap-heading">{boardCanvasT('minimapHeading')}</h2>
                  <span>{fixtureT('minimapCount')}</span>
                </div>
                <button className="board-minimap-surface" type="button">
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
              </section>
            )}
            detailsPanel={(
              <section className="board-canvas-panel-overlay board-details" aria-labelledby="details-heading" tabIndex={0}>
                <h2 id="details-heading">{boardCanvasT('selectionHeading')}</h2>
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
            )}
            settingsPanel={(
              <section className="board-canvas-panel-overlay board-canvas-settings-panel" aria-labelledby="settings-heading" tabIndex={0}>
                <h2 id="settings-heading">{boardCanvasT('settingsHeading')}</h2>
                <div className="board-canvas-settings-row">
                  <button className="button button-secondary" type="button">{boardCanvasT('resetCamera')}</button>
                  <button className="button button-secondary" type="button">{boardCanvasT('refresh')}</button>
                </div>
              </section>
            )}
          />
        </section>
      </NextIntlClientProvider>
    </main>
  );
}
