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

    if (specifier === '@/lib/session-api') {
      return {
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

const {BoardInviteContent, BoardJoinSuccessBanner, isBoardNotFoundStatus, resolveRoleLabelKey} = await loadModule();
const {renderToStaticMarkup} = await import('react-dom/server');
const React = await import('react');

const t = (key) => ({
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
  successHeading: 'You joined the board',
  successDismiss: 'Dismiss this message',
  errorMessage: 'Unable to join the board'
})[key];

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
