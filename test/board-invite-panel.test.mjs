import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule() {
  const source = await readFile(path.join(root, 'src/components/board-invite-panel.tsx'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  });

  const moduleShim = {exports: {}};
  const require = createRequire(import.meta.url);
  const mockRequire = (specifier) => {
    if (specifier === '@/components/board-canvas-panel') {
      return {__esModule: true, default: () => null};
    }

    if (specifier === '@/components/auth-panel') {
      return {__esModule: true, default: () => null};
    }

    if (specifier === '@/components/plan-unavailable-panel') {
      return {__esModule: true, default: () => null};
    }

    if (specifier === '@/lib/board-role-label') {
      return {
        resolveRoleLabelKey: (roleCode) => ({
          owner: 'ownerRole',
          editor: 'editorRole',
          commenter: 'commenterRole',
          viewer: 'viewerRole'
        })[roleCode] ?? null
      };
    }

    if (specifier === '@/lib/session-api') {
      return {
        ensureDevSession: async () => ({authenticated: true, xUserId: 'dev-user'}),
        establishDevSession: async () => ({authenticated: true, xUserId: 'dev-user'}),
        isPlanGated: (session) => session?.planCode !== 'member',
        resolveFollowTargetHandle: () => ({errorMessage: null, followTargetHandle: 'rictaworks'}),
        requestManualRecheck: async () => ({authenticated: true}),
        SessionExpiredError: class SessionExpiredError extends Error {}
      };
    }

    if (specifier === '@/lib/x-auth') {
      return {readXAuthSettings: () => ({backendUrl: 'http://localhost'})};
    }

    if (specifier === 'next-intl') {
      return {useTranslations: () => (key) => key};
    }

    if (specifier === '@fortawesome/free-solid-svg-icons') {
      return {faSpinner: {}, faXmark: {}};
    }

    if (specifier === '@fortawesome/react-fontawesome') {
      return {FontAwesomeIcon: () => null};
    }

    return require(specifier);
  };

  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, mockRequire);
  return moduleShim.exports;
}

const {
  BoardInviteContent,
  BoardJoinSuccessBanner,
  BoardErrorBanner,
  createMembershipBannerContent,
  createExistingMembershipNotice,
  isBoardNotFoundStatus,
  resolveRoleLabelKey
} = await loadModule();
const {renderToStaticMarkup} = await import('react-dom/server');
const React = await import('react');

const t = (key, values = {}) => ({
  heading: 'Join a board',
  description: 'Open the share URL and choose the role you want to join with.',
  roleLabel: 'Invite role',
  viewerRole: 'Viewer',
  commenterRole: 'Commenter',
  editorRole: 'Editor',
  joinButton: 'Join with this role',
  joiningButton: 'Joining...',
  notFoundHeading: 'Board not found',
  notFoundDescription: 'The share URL is invalid or this board no longer exists.',
  ownerRole: 'Owner',
  existingMembershipHeading: 'You are already a board member',
  existingMembershipDescription: `You already belong to "${values.title}" as ${values.role}.`,
  successHeading: 'You joined the board',
  successDescription: `You joined "${values.title}" as ${values.role}.`,
  successDismiss: 'Dismiss this message',
  errorMessage: 'Unable to join the board'
})[key];

test('existing owner membership renders a distinct confirmation from first-time join success', () => {
  const notice = createExistingMembershipNotice({
    board: {title: 'Sprint board'},
    membership: {role: {code: 'owner'}}
  });
  const content = createMembershipBannerContent(notice, t);
  const markup = renderToStaticMarkup(React.createElement(BoardJoinSuccessBanner, {
    ...content,
    onDismiss: () => {}
  }));

  assert.deepEqual(notice, {kind: 'existing', roleCode: 'owner', title: 'Sprint board'});
  assert.match(markup, /You are already a board member/);
  assert.match(markup, /already belong to &quot;Sprint board&quot; as Owner/);
  assert.equal(markup.includes('You joined the board'), false);
});

test('first-time join keeps the join-success message', () => {
  const content = createMembershipBannerContent({
    kind: 'joined',
    roleCode: 'commenter',
    title: 'Sprint board'
  }, t);

  assert.equal(content.heading, 'You joined the board');
  assert.equal(content.description, 'You joined "Sprint board" as Commenter.');
});

test('board invite status helper distinguishes 404 from 403', () => {
  assert.equal(isBoardNotFoundStatus(404), true);
  assert.equal(isBoardNotFoundStatus(403), false);
});

test('board invite content hides the join form for missing boards', () => {
  const markup = renderToStaticMarkup(React.createElement(BoardInviteContent, {
    boardNotFound: true,
    errorMessage: null,
    joining: false,
    onJoin: () => {},
    onRoleCodeChange: () => {},
    roleCode: 'viewer',
    t
  }));

  assert.match(markup, /Board not found/);
  assert.match(markup, /The share URL is invalid or this board no longer exists\./);
  assert.equal(markup.includes('Join with this role'), false);
  assert.equal(markup.includes('<form'), false);
});

test('board invite content keeps the join form for forbidden boards', () => {
  const markup = renderToStaticMarkup(React.createElement(BoardInviteContent, {
    boardNotFound: false,
    errorMessage: null,
    joining: false,
    onJoin: () => {},
    onRoleCodeChange: () => {},
    roleCode: 'viewer',
    t
  }));

  assert.match(markup, /Join a board/);
  assert.match(markup, /Join with this role/);
  assert.match(markup, /Invite role/);
  assert.match(markup, /<form/);
});

test('role codes map to their own label key and unknown codes stay unmapped', () => {
  assert.equal(resolveRoleLabelKey('owner'), 'ownerRole');
  assert.equal(resolveRoleLabelKey('editor'), 'editorRole');
  assert.equal(resolveRoleLabelKey('commenter'), 'commenterRole');
  assert.equal(resolveRoleLabelKey('viewer'), 'viewerRole');
  assert.equal(resolveRoleLabelKey('unknown-role'), null);
  assert.equal(resolveRoleLabelKey(''), null);
});

test('join success banner announces the outcome and the confirmed role', () => {
  const markup = renderToStaticMarkup(React.createElement(BoardJoinSuccessBanner, {
    description: 'You joined "Sprint board" as Commenter.',
    dismissLabel: 'Dismiss this message',
    heading: 'You joined the board',
    onDismiss: () => {}
  }));

  assert.match(markup, /role="status"/);
  assert.match(markup, /You joined the board/);
  assert.match(markup, /as Commenter\./);
  assert.match(markup, /aria-label="Dismiss this message"/);
});

test('board error banner announces the error message with role="alert"', () => {
  const markup = renderToStaticMarkup(React.createElement(BoardErrorBanner, {
    message: 'Unable to sign out',
    dismissLabel: 'Dismiss this message',
    onDismiss: () => {}
  }));

  assert.match(markup, /role="alert"/);
  assert.match(markup, /Unable to sign out/);
  assert.match(markup, /aria-label="Dismiss this message"/);
});

// 開発認証バイパスは見た目だけ認証済みに見せかけ、xUserId も無関係な固定文字列
// （'development-x-user-id'）を渡していたため、実際に発行される開発用セッション
// （dev/session_controller.rb の DEV_USER_X_ID = 'dev-user'）と一致せず、
// KPIイベント送信（AnalyticsTracker）が毎回 422 で拒否されていた
// （オンボーディングクエストの進捗が記録されない不具合）。dev セッションを
// 実際に確立し、本物のセッションから得た xUserId を使うことを退行防止として固定する。
// issue #194 以降は共有版の ensureDevSession（POST /dev/session を1回に束ねる）を使う。
test('development bypass establishes a real backend session and does not use the stale placeholder x user id', async () => {
  const source = await readFile(path.join(root, 'src/components/board-invite-panel.tsx'), 'utf8');

  assert.match(source, /ensureDevSession/);
  assert.doesNotMatch(source, /development-x-user-id/, 'バックエンドの実際の値と一致しない固定プレースホルダーが残っている');
});
