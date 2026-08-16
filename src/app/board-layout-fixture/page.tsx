import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
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

  return (
    <main className="home-shell">
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
        <header className="board-canvas-header">
          <div>
            <p className="board-canvas-kicker">{boardCanvasT('heading')}</p>
            <h1>{fixtureT('title')}</h1>
          </div>
          <div className="board-canvas-toolbar">
            <button className="button button-secondary" type="button">{fixtureT('sticky')}</button>
            <button className="button button-secondary" type="button">{fixtureT('shape')}</button>
            <button className="button button-secondary" type="button">{boardCanvasT('resetCamera')}</button>
            <div className="board-sync-status board-sync-status-connected" role="status">
              <span>{boardCanvasT('connectionConnected')}</span>
            </div>
            <div className="board-user-avatar-container">
              <button
                aria-haspopup="menu"
                aria-label={boardCanvasT('userMenuLabel')}
                className="board-user-avatar-button"
                type="button"
              >
                <span aria-hidden="true" className="board-user-avatar-initials">{fixtureT('userInitials')}</span>
              </button>
            </div>
          </div>
        </header>

        <div className="board-canvas-body">
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

          <aside className="board-sidebar">
            <section className="board-quest-panel" aria-labelledby="quest-panel-heading" tabIndex={0}>
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

            <section className="board-minimap" aria-labelledby="minimap-heading" tabIndex={0}>
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

            <section className="board-details" aria-labelledby="details-heading" tabIndex={0}>
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
          </aside>
        </div>
      </section>
    </main>
  );
}
