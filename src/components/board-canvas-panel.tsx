"use client";

import {faClone, faComment, faLock, faPenToSquare, faPalette, faRotateRight, faTrashCan, faUnlock} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent} from 'react';
import {useTranslations} from 'next-intl';

import {CameraController, createCameraState, type CameraBounds, type CameraState} from '@/lib/camera-controller';
import {canPerformBoardAction, type BoardObjectLockState, type BoardRoleCode} from '@/lib/board-permissions';
import {readGoogleAuthSettings} from '@/lib/google-auth';

export interface BoardCanvasObject {
  id: number;
  boardId: number;
  objectTypeCode: string;
  colorId: number;
  parentFrameId?: number | null;
  geometry: {x: number; y: number; w: number; h: number; rotation: number};
  deletedAt?: string | null;
  locked: boolean;
  lockedByUserId?: number | null;
  lockedAt?: string | null;
  lockOriginObjectId?: number | null;
  commentCount?: number | null;
}

export interface BoardCanvasComment {
  id: number;
  objectId: number;
  userId: number;
  userDisplayName: string;
  body: string;
  createdAt: string;
}

export interface BoardCanvasData {
  board: {id: number; title: string; shareToken: string};
  membership: {userId: number; role: {id: number; code: BoardRoleCode}};
  objectTypes: Array<{id: number; code: string}>;
  colorPalettes: Array<{id: number; hex: string}>;
  objects: BoardCanvasObject[];
  comments: BoardCanvasComment[];
}

type BoardCanvasPanelProps = {
  boardData: BoardCanvasData;
  onReloadBoard: () => Promise<void>;
};

type Interaction =
  | {kind: 'move'; objectId: number; startX: number; startY: number; origin: BoardCanvasObject['geometry']}
  | {kind: 'resize'; objectId: number; startX: number; startY: number; origin: BoardCanvasObject['geometry']}
  | {kind: 'rotate'; objectId: number; startX: number; startY: number; origin: BoardCanvasObject['geometry']}
  | {kind: 'marquee'; startX: number; startY: number; currentX: number; currentY: number}
  | null;

type ToastItem = {id: number; message: string};

const DEFAULT_OBJECT_SIZE = {w: 160, h: 120};

export default function BoardCanvasPanel({boardData, onReloadBoard}: BoardCanvasPanelProps) {
  const t = useTranslations('BoardCanvas');
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef(new CameraController(createCameraState()));
  const interactionRef = useRef<Interaction>(null);
  const toastIdRef = useRef(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [viewport, setViewport] = useState({width: 0, height: 0});
  const [cameraState, setCameraState] = useState<CameraState>(createCameraState);
  const [selection, setSelection] = useState<number[]>([]);
  const [interaction, setInteraction] = useState<Interaction>(null);
  const [previewGeometry, setPreviewGeometry] = useState<Record<number, BoardCanvasObject['geometry']>>({});
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const cameraStateRef = useRef<CameraState>(cameraState);
  const objectsRef = useRef<BoardCanvasObject[]>([]);
  const previewGeometryRef = useRef<Record<number, BoardCanvasObject['geometry']>>({});

  const objects = useMemo(() => boardData.objects.filter((object) => object.deletedAt == null), [boardData.objects]);
  const currentUserId = boardData.membership.userId;
  const roleCode = boardData.membership.role.code;
  const contentBounds = useMemo<CameraBounds | null>(() => resolveContentBounds(objects), [objects]);
  const selectedObjects = useMemo(
    () => objects.filter((object) => selection.includes(object.id)),
    [objects, selection]
  );
  const selectedObject = selectedObjects[0] ?? null;
  const canViewComments = roleCode !== 'viewer';
  const canCreateComments = roleCode !== 'viewer';
  const canCreateObject = canPerformBoardAction(roleCode, 'create', null, currentUserId);

  useEffect(() => {
    cameraStateRef.current = cameraState;
  }, [cameraState]);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  useEffect(() => {
    previewGeometryRef.current = previewGeometry;
  }, [previewGeometry]);

  useEffect(() => {
    if (viewport.width <= 0 || viewport.height <= 0) {
      return;
    }

    const nextCamera = controllerRef.current.fitToContent(contentBounds, viewport);
    setCameraState({...nextCamera});
  }, [contentBounds, viewport]);

  useEffect(() => {
    if (!canvasRef.current || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    resizeObserverRef.current = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setViewport({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });
    resizeObserverRef.current.observe(canvasRef.current);

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, []);

  const enqueueToast = useCallback((message: string) => {
    const id = ++toastIdRef.current;
    setToasts((current) => [...current, {id, message}]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const mutateObject = useCallback(
    async (
      objectId: number,
      action: 'move' | 'resize' | 'rotate' | 'duplicate' | 'color' | 'delete' | 'lock' | 'unlock',
      payload: Record<string, unknown> = {}
    ) => {
      const object = objects.find((entry) => entry.id === objectId);
      if (!object) {
        return;
      }

      if (!canPerformBoardAction(roleCode, actionToPermission(action), objectToLockState(object), currentUserId)) {
        enqueueToast(t('permissionDenied'));
        return;
      }

      try {
        const {backendUrl} = readGoogleAuthSettings();
        const {url, method, headers} = buildMutationRequest(boardData.board.shareToken, objectId, action);
        const body = headers && Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined;
        const response = await fetch(`${backendUrl}${url}`, {
          body,
          credentials: 'include',
          headers: body ? headers : undefined,
          method,
        });

        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => ({}))) as {error?: string};
          throw new Error(errorPayload.error ?? t('actionFailed'));
        }

        await onReloadBoard();
      } catch (error) {
        enqueueToast(error instanceof Error ? error.message : t('actionFailed'));
      }
    },
    [boardData.board.shareToken, currentUserId, enqueueToast, objects, onReloadBoard, roleCode, t]
  );

  useEffect(() => {
    if (!interaction) {
      interactionRef.current = null;
      return;
    }

    interactionRef.current = interaction;

    const handleMove = (event: PointerEvent) => {
      const current = interactionRef.current;
      if (!current) {
        return;
      }

      if (current.kind === 'marquee') {
        const stageRect = canvasRef.current?.getBoundingClientRect();
        setInteraction({
          ...current,
          currentX: event.clientX - (stageRect?.left ?? 0),
          currentY: event.clientY - (stageRect?.top ?? 0),
        });
        return;
      }

      const deltaX = (event.clientX - current.startX) / Math.max(cameraStateRef.current.zoom, 0.01);
      const deltaY = (event.clientY - current.startY) / Math.max(cameraStateRef.current.zoom, 0.01);

      if (current.kind === 'move') {
        setPreviewGeometry((previous) => ({
          ...previous,
          [current.objectId]: {
            ...current.origin,
            x: current.origin.x + deltaX,
            y: current.origin.y + deltaY,
          },
        }));
        return;
      }

      if (current.kind === 'resize') {
        setPreviewGeometry((previous) => ({
          ...previous,
          [current.objectId]: {
            ...current.origin,
            w: Math.max(48, current.origin.w + deltaX),
            h: Math.max(48, current.origin.h + deltaY),
          },
        }));
        return;
      }

      if (current.kind === 'rotate') {
        const stageRect = canvasRef.current?.getBoundingClientRect();
        const stageLeft = stageRect?.left ?? 0;
        const stageTop = stageRect?.top ?? 0;

        const centerWorldX = current.origin.x + current.origin.w / 2;
        const centerWorldY = current.origin.y + current.origin.h / 2;
        const centerScreenX = stageLeft + viewport.width / 2 + (centerWorldX - cameraStateRef.current.x) * cameraStateRef.current.zoom;
        const centerScreenY = stageTop + viewport.height / 2 + (centerWorldY - cameraStateRef.current.y) * cameraStateRef.current.zoom;

        const startAngle = Math.atan2(current.startY - centerScreenY, current.startX - centerScreenX);
        const nextAngle = Math.atan2(event.clientY - centerScreenY, event.clientX - centerScreenX);
        const nextRotation = current.origin.rotation + ((nextAngle - startAngle) * 180) / Math.PI;
        setPreviewGeometry((previous) => ({
          ...previous,
          [current.objectId]: {
            ...current.origin,
            rotation: Math.round(nextRotation),
          },
        }));
      }
    };

    const handleUp = async () => {
      const current = interactionRef.current;
      interactionRef.current = null;
      setInteraction(null);

      if (!current) {
        return;
      }

      if (current.kind === 'marquee') {
        const selectionRect = normalizeRect(current.startX, current.startY, current.currentX, current.currentY);
        const nextSelection = objectsRef.current
          .filter((object) => intersects(selectionRect, objectToScreenRect(object.geometry, cameraStateRef.current, viewport)))
          .map((object) => object.id);
        setSelection(nextSelection);
        return;
      }

      const targetObject = objectsRef.current.find((object) => object.id === current.objectId);
      if (!targetObject) {
        return;
      }

      const nextGeometry = previewGeometryRef.current[targetObject.id] ?? targetObject.geometry;
      setPreviewGeometry({});

      if (current.kind === 'move') {
        if (nextGeometry.x !== targetObject.geometry.x || nextGeometry.y !== targetObject.geometry.y) {
          await mutateObject(targetObject.id, 'move', {
            geometry: {x: Math.round(nextGeometry.x), y: Math.round(nextGeometry.y)},
          });
        }
      } else if (current.kind === 'resize') {
        await mutateObject(targetObject.id, 'resize', {
          geometry: {w: Math.round(nextGeometry.w), h: Math.round(nextGeometry.h)},
        });
      } else if (current.kind === 'rotate') {
        await mutateObject(targetObject.id, 'rotate', {
          geometry: {rotation: Math.round(nextGeometry.rotation)},
        });
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, {once: true});

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [interaction, mutateObject, viewport]);

  const visibleObjects = useMemo(() => objects.map((object) => {
    const draft = previewGeometry[object.id];
    return draft ? {...object, geometry: draft} : object;
  }), [objects, previewGeometry]);

  function handleBackgroundPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) {
      return;
    }

    const stageRect = canvasRef.current?.getBoundingClientRect();
    setSelection([]);
    setInteraction({
      kind: 'marquee',
      startX: event.clientX - (stageRect?.left ?? 0),
      startY: event.clientY - (stageRect?.top ?? 0),
      currentX: event.clientX - (stageRect?.left ?? 0),
      currentY: event.clientY - (stageRect?.top ?? 0),
    });
  }

  function handleObjectPointerDown(object: BoardCanvasObject, event: ReactPointerEvent<HTMLElement>) {
    event.stopPropagation();

    if (!canPerformBoardAction(roleCode, 'move', objectToLockState(object), currentUserId)) {
      enqueueToast(t('permissionDenied'));
      setSelection([object.id]);
      return;
    }

    setSelection([object.id]);
    setInteraction({
      kind: 'move',
      objectId: object.id,
      startX: event.clientX,
      startY: event.clientY,
      origin: object.geometry,
    });
  }

  function handleResizePointerDown(object: BoardCanvasObject, event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setSelection([object.id]);
    setInteraction({
      kind: 'resize',
      objectId: object.id,
      startX: event.clientX,
      startY: event.clientY,
      origin: object.geometry,
    });
  }

  function handleRotatePointerDown(object: BoardCanvasObject, event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setSelection([object.id]);
    setInteraction({
      kind: 'rotate',
      objectId: object.id,
      startX: event.clientX,
      startY: event.clientY,
      origin: object.geometry,
    });
  }

  async function createObject(objectTypeCode: string) {
    try {
      if (!canPerformBoardAction(roleCode, 'create', null, currentUserId)) {
        enqueueToast(t('permissionDenied'));
        return;
      }

      const {backendUrl} = readGoogleAuthSettings();
      const nextGeometry = {
        x: Math.max(cameraStateRef.current.x - DEFAULT_OBJECT_SIZE.w / 2, 0),
        y: Math.max(cameraStateRef.current.y - DEFAULT_OBJECT_SIZE.h / 2, 0),
        w: DEFAULT_OBJECT_SIZE.w,
        h: DEFAULT_OBJECT_SIZE.h,
        rotation: 0,
      };

      const response = await fetch(`${backendUrl}/boards/${encodeURIComponent(boardData.board.shareToken)}/objects`, {
        body: JSON.stringify({object_type_code: objectTypeCode, geometry: nextGeometry}),
        credentials: 'include',
        headers: {'Content-Type': 'application/json'},
        method: 'POST',
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({})) as {error?: string};
        throw new Error(errorPayload.error ?? t('actionFailed'));
      }

      await onReloadBoard();
    } catch (error) {
      enqueueToast(error instanceof Error ? error.message : t('actionFailed'));
    }
  }

  function changeColor(object: BoardCanvasObject, colorId: number) {
    void mutateObject(object.id, 'color', {color_id: colorId});
  }

  function duplicateSelection() {
    const active = selectedObjects[0];
    if (!active) {
      return;
    }

    void mutateObject(active.id, 'duplicate');
  }

  function deleteSelection() {
    const active = selectedObjects[0];
    if (!active) {
      return;
    }

    void mutateObject(active.id, 'delete');
  }

  function toggleLock(object: BoardCanvasObject) {
    const isInheritedLock = object.locked && object.lockOriginObjectId != null && object.lockOriginObjectId !== object.id;
    if (isInheritedLock) {
      enqueueToast(t('permissionDenied'));
      return;
    }

    void mutateObject(object.id, object.locked ? 'unlock' : 'lock');
  }

  function focusMinimap(event: ReactMouseEvent<HTMLButtonElement>) {
    const minimap = event.currentTarget.getBoundingClientRect();
    const click = {x: event.clientX, y: event.clientY};
    controllerRef.current.focusOnMinimapClick({
      click,
      minimap: {
        left: minimap.left,
        top: minimap.top,
        right: minimap.right,
        bottom: minimap.bottom,
      },
      contentBounds,
    });
    setCameraState({...controllerRef.current.getState()});
  }

  const minimap = resolveMinimapBounds(viewport);
  const viewportRect = resolveViewportRect(cameraState, viewport, contentBounds, minimap);

  return (
    <section className="board-canvas-shell">
      <header className="board-canvas-header">
        <div>
          <p className="board-canvas-kicker">{t('heading')}</p>
          <h1>{boardData.board.title}</h1>
        </div>
        <div className="board-canvas-toolbar">
          {boardData.objectTypes.map((type) => (
            <button className="button button-secondary" disabled={!canCreateObject} key={type.id} onClick={() => void createObject(type.code)} type="button">
              {type.code}
            </button>
          ))}
          {selectedObjects[0] ? (
            <>
              <button className="button button-secondary" onClick={duplicateSelection} type="button">
                <FontAwesomeIcon icon={faClone} />
                <span>{t('duplicate')}</span>
              </button>
              <button className="button button-secondary" onClick={deleteSelection} type="button">
                <FontAwesomeIcon icon={faTrashCan} />
                <span>{t('delete')}</span>
              </button>
            </>
          ) : null}
          <button className="button button-secondary" onClick={onReloadBoard} type="button">
            {t('refresh')}
          </button>
        </div>
      </header>

      <div className="board-canvas-body">
        <div className="board-stage" ref={canvasRef}>
          <div
            aria-label={t('canvasLabel')}
            className="board-scene"
            onPointerDown={handleBackgroundPointerDown}
            style={sceneStyle(cameraState, viewport)}
          >
            {visibleObjects.map((object) => (
              <article
                className={`board-object board-object-${object.objectTypeCode} ${selection.includes(object.id) ? 'is-selected' : ''} ${object.locked && object.lockedByUserId !== currentUserId ? 'is-locked' : ''}`}
                key={object.id}
                style={objectStyle(object.geometry)}
                onPointerDown={(event) => handleObjectPointerDown(object, event)}
              >
                {object.objectTypeCode === 'connector' ? <svg className="connector-line" viewBox="0 0 100 100"><line x1="10" y1="50" x2="90" y2="50" /></svg> : null}
                <div className="board-object-label">{object.objectTypeCode}</div>
                {canViewComments && (object.commentCount ?? 0) > 0 ? (
                  <span className="comment-badge">
                    <FontAwesomeIcon icon={faComment} />
                    <span>{object.commentCount}</span>
                  </span>
                ) : null}
                {object.locked ? (
                  <span className="lock-badge">
                    <FontAwesomeIcon icon={faLock} />
                    <span>{object.lockedByUserId === currentUserId ? t('lockedByYou') : t('lockedByOther')}</span>
                  </span>
                ) : null}
                <button
                  className="board-object-action board-object-action-rotate"
                  disabled={!canPerformBoardAction(roleCode, 'rotate', objectToLockState(object), currentUserId)}
                  onPointerDown={(event) => handleRotatePointerDown(object, event)}
                  type="button"
                >
                  <FontAwesomeIcon icon={faRotateRight} />
                </button>
                <button
                  className="board-object-action board-object-action-resize"
                  disabled={!canPerformBoardAction(roleCode, 'resize', objectToLockState(object), currentUserId)}
                  onPointerDown={(event) => handleResizePointerDown(object, event)}
                  type="button"
                >
                  <FontAwesomeIcon icon={faPenToSquare} />
                </button>
                <button
                  className="board-object-action board-object-action-color"
                  disabled={!canPerformBoardAction(roleCode, 'recolor', objectToLockState(object), currentUserId)}
                  onClick={(event) => {
                    event.stopPropagation();
                    changeColor(object, nextColorId(object, boardData.colorPalettes));
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <FontAwesomeIcon icon={faPalette} />
                </button>
                <button
                  className="board-object-action board-object-action-lock"
                  disabled={object.locked && object.lockOriginObjectId != null && object.lockOriginObjectId !== object.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleLock(object);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <FontAwesomeIcon icon={object.locked ? faUnlock : faLock} />
                </button>
              </article>
            ))}
            {interaction?.kind === 'marquee' ? (
              <div className="selection-marquee" style={selectionStyle(interaction, cameraState, viewport)} />
            ) : null}
          </div>
        </div>

        <aside className="board-sidebar">
          <section className="board-minimap">
            <div className="board-minimap-header">
              <h2>{t('minimapHeading')}</h2>
              <span>{selectedObjects.length}</span>
            </div>
            <button className="board-minimap-surface" onClick={focusMinimap} type="button">
              {objects.map((object) => (
                <div
                  className={`board-minimap-dot board-minimap-dot-${object.objectTypeCode} ${selection.includes(object.id) ? 'is-selected' : ''}`}
                  key={object.id}
                  style={minimapDotStyle(object.geometry, contentBounds, minimap)}
                />
              ))}
              <div className="board-minimap-viewport" style={viewportRect} />
            </button>
          </section>

          {selectedObject ? (
            <section className="board-details">
              <h2>{t('selectionHeading')}</h2>
              <p>{selectedObject.objectTypeCode}</p>
              <div className="board-color-grid">
                {boardData.colorPalettes.map((color) => (
                  <button
                    className={`board-color-swatch ${selectedObject.colorId === color.id ? 'is-active' : ''}`}
                    key={color.id}
                    onClick={() => changeColor(selectedObject, color.id)}
                    style={{backgroundColor: color.hex}}
                    type="button"
                  />
                ))}
              </div>
              {canViewComments ? (
                <BoardComments
                  key={selectedObject.id}
                  selectedObject={selectedObject}
                  boardData={boardData}
                  currentUserId={currentUserId}
                  roleCode={roleCode}
                  onReloadBoard={onReloadBoard}
                  t={t}
                  enqueueToast={enqueueToast}
                  canCreateComments={canCreateComments}
                />
              ) : (
                <p className="board-comments-empty">{t('commentsHidden')}</p>
              )}
            </section>
          ) : null}
        </aside>
      </div>

      <div className="board-toasts" aria-live="polite">
        {toasts.map((toast) => (
          <p className="board-toast" key={toast.id} role="status">
            {toast.message}
          </p>
        ))}
      </div>
    </section>
  );
}

function actionToPermission(action: string): 'move' | 'resize' | 'rotate' | 'duplicate' | 'recolor' | 'delete' | 'lock' | 'unlock' {
  switch (action) {
    case 'color':
      return 'recolor';
    case 'duplicate':
      return 'duplicate';
    case 'delete':
      return 'delete';
    default:
      return action as 'move' | 'resize' | 'rotate' | 'duplicate' | 'recolor' | 'delete' | 'lock' | 'unlock';
  }
}

function objectToLockState(object: BoardCanvasObject): BoardObjectLockState {
  return {
    locked: object.locked,
    lockedByUserId: object.lockedByUserId ?? null,
  };
}

function buildMutationRequest(
  shareToken: string,
  objectId: number,
  action: 'move' | 'resize' | 'rotate' | 'duplicate' | 'color' | 'delete' | 'lock' | 'unlock'
): {url: string; method: 'POST' | 'PATCH' | 'DELETE'; headers?: Record<string, string>} {
  const prefix = `/boards/${encodeURIComponent(shareToken)}/objects/${objectId}`;

  switch (action) {
    case 'delete':
      return {url: prefix, method: 'DELETE'};
    case 'lock':
      return {url: `${prefix}/lock`, method: 'POST'};
    case 'unlock':
      return {url: `${prefix}/lock`, method: 'DELETE'};
    case 'duplicate':
      return {url: `${prefix}/duplicate`, method: 'POST', headers: {'Content-Type': 'application/json'}};
    case 'color':
      return {url: `${prefix}/color`, method: 'PATCH', headers: {'Content-Type': 'application/json'}};
    default:
      return {url: `${prefix}/${action}`, method: 'PATCH', headers: {'Content-Type': 'application/json'}};
  }
}

function resolveContentBounds(objects: BoardCanvasObject[]): CameraBounds | null {
  if (objects.length === 0) {
    return null;
  }

  return objects.reduce<CameraBounds>((bounds, object) => {
    const x = object.geometry.x;
    const y = object.geometry.y;
    const right = object.geometry.x + object.geometry.w;
    const bottom = object.geometry.y + object.geometry.h;
    return {
      left: Math.min(bounds.left, x),
      top: Math.min(bounds.top, y),
      right: Math.max(bounds.right, right),
      bottom: Math.max(bounds.bottom, bottom),
    };
  }, {
    left: objects[0].geometry.x,
    top: objects[0].geometry.y,
    right: objects[0].geometry.x + objects[0].geometry.w,
    bottom: objects[0].geometry.y + objects[0].geometry.h,
  });
}

function sceneStyle(cameraState: CameraState, viewport: {width: number; height: number}) {
  return {
    transform: `translate(${viewport.width / 2 - cameraState.x * cameraState.zoom}px, ${viewport.height / 2 - cameraState.y * cameraState.zoom}px) scale(${cameraState.zoom})`,
    transformOrigin: '0 0',
  } as const;
}

function objectStyle(geometry: BoardCanvasObject['geometry']) {
  return {
    left: `${geometry.x}px`,
    top: `${geometry.y}px`,
    width: `${geometry.w}px`,
    height: `${geometry.h}px`,
    transform: `rotate(${geometry.rotation}deg)`,
  } as const;
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number) {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  };
}

function selectionStyle(
  interaction: Extract<Interaction, {kind: 'marquee'}>,
  camera: CameraState,
  viewport: {width: number; height: number}
) {
  const rect = normalizeRect(interaction.startX, interaction.startY, interaction.currentX, interaction.currentY);
  const worldLeft = (rect.left - viewport.width / 2) / Math.max(camera.zoom, 0.01) + camera.x;
  const worldTop = (rect.top - viewport.height / 2) / Math.max(camera.zoom, 0.01) + camera.y;
  const worldWidth = (rect.right - rect.left) / Math.max(camera.zoom, 0.01);
  const worldHeight = (rect.bottom - rect.top) / Math.max(camera.zoom, 0.01);
  return {
    left: `${worldLeft}px`,
    top: `${worldTop}px`,
    width: `${worldWidth}px`,
    height: `${worldHeight}px`,
  } as const;
}

function objectToScreenRect(geometry: BoardCanvasObject['geometry'], camera: CameraState, viewport: {width: number; height: number}) {
  const left = viewport.width / 2 + (geometry.x - camera.x) * camera.zoom;
  const top = viewport.height / 2 + (geometry.y - camera.y) * camera.zoom;
  return {
    left,
    top,
    right: left + geometry.w * camera.zoom,
    bottom: top + geometry.h * camera.zoom,
  };
}

function intersects(a: {left: number; top: number; right: number; bottom: number}, b: {left: number; top: number; right: number; bottom: number}) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function resolveMinimapBounds(viewport: {width: number; height: number}) {
  const width = Math.max(viewport.width * 0.22, 160);
  const height = Math.max(viewport.height * 0.22, 120);

  return {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
  };
}

function resolveViewportRect(camera: CameraState, viewport: {width: number; height: number}, contentBounds: CameraBounds | null, minimap: CameraBounds) {
  if (!contentBounds) {
    return {
      left: '8px',
      top: '8px',
      width: '32px',
      height: '24px',
    };
  }

  const contentWidth = Math.max(contentBounds.right - contentBounds.left, 1);
  const contentHeight = Math.max(contentBounds.bottom - contentBounds.top, 1);
  const worldLeft = camera.x - viewport.width / (2 * Math.max(camera.zoom, 0.01));
  const worldTop = camera.y - viewport.height / (2 * Math.max(camera.zoom, 0.01));
  const worldRight = camera.x + viewport.width / (2 * Math.max(camera.zoom, 0.01));
  const worldBottom = camera.y + viewport.height / (2 * Math.max(camera.zoom, 0.01));
  const scaleX = (minimap.right - minimap.left) / contentWidth;
  const scaleY = (minimap.bottom - minimap.top) / contentHeight;

  return {
    left: `${(worldLeft - contentBounds.left) * scaleX}px`,
    top: `${(worldTop - contentBounds.top) * scaleY}px`,
    width: `${Math.max((worldRight - worldLeft) * scaleX, 12)}px`,
    height: `${Math.max((worldBottom - worldTop) * scaleY, 12)}px`,
  };
}

function minimapDotStyle(
  geometry: BoardCanvasObject['geometry'],
  contentBounds: CameraBounds | null,
  minimap: CameraBounds
) {
  if (!contentBounds) {
    return {left: '0px', top: '0px', width: '4px', height: '4px'};
  }

  const contentWidth = Math.max(contentBounds.right - contentBounds.left, 1);
  const contentHeight = Math.max(contentBounds.bottom - contentBounds.top, 1);
  const scaleX = (minimap.right - minimap.left) / contentWidth;
  const scaleY = (minimap.bottom - minimap.top) / contentHeight;

  return {
    left: `${(geometry.x - contentBounds.left) * scaleX}px`,
    top: `${(geometry.y - contentBounds.top) * scaleY}px`,
    width: `${Math.max(geometry.w * scaleX, 4)}px`,
    height: `${Math.max(geometry.h * scaleY, 4)}px`,
  } as const;
}

function nextColorId(object: BoardCanvasObject, colors: Array<{id: number}>) {
  if (colors.length === 0) {
    return object.colorId;
  }

  const currentIndex = colors.findIndex((color) => color.id === object.colorId);
  return colors[(currentIndex + 1) % colors.length]?.id ?? object.colorId;
}

interface BoardCommentsProps {
  selectedObject: BoardCanvasObject;
  boardData: BoardCanvasData;
  currentUserId: number;
  roleCode: string;
  onReloadBoard: () => Promise<void>;
  t: (key: string) => string;
  enqueueToast: (message: string) => void;
  canCreateComments: boolean;
}

function BoardComments({
  selectedObject,
  boardData,
  currentUserId,
  roleCode,
  onReloadBoard,
  t,
  enqueueToast,
  canCreateComments
}: BoardCommentsProps) {
  const [commentDraft, setCommentDraft] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentDraft, setEditingCommentDraft] = useState('');

  const selectedComments = useMemo(
    () => boardData.comments.filter((comment) => comment.objectId === selectedObject.id),
    [boardData.comments, selectedObject.id]
  );

  async function mutateComment(action: 'create' | 'update' | 'delete', commentId?: number) {
    const {backendUrl} = readGoogleAuthSettings();
    const prefix = `${backendUrl}/boards/${encodeURIComponent(boardData.board.shareToken)}/objects/${selectedObject.id}/comments`;

    try {
      let response: Response;
      if (action === 'create') {
        const body = commentDraft.trim();
        if (!body) {
          enqueueToast(t('commentBodyRequired'));
          return;
        }

        response = await fetch(prefix, {
          body: JSON.stringify({body}),
          credentials: 'include',
          headers: {'Content-Type': 'application/json'},
          method: 'POST'
        });
      } else if (action === 'update') {
        const body = editingCommentDraft.trim();
        if (!body || commentId == null) {
          enqueueToast(t('commentBodyRequired'));
          return;
        }

        response = await fetch(`${prefix}/${commentId}`, {
          body: JSON.stringify({body}),
          credentials: 'include',
          headers: {'Content-Type': 'application/json'},
          method: 'PATCH'
        });
      } else {
        if (commentId == null) {
          return;
        }

        response = await fetch(`${prefix}/${commentId}`, {
          credentials: 'include',
          method: 'DELETE'
        });
      }

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({})) as {error?: string};
        throw new Error(errorPayload.error ?? t('actionFailed'));
      }

      setCommentDraft('');
      setEditingCommentId(null);
      setEditingCommentDraft('');
      await onReloadBoard();
    } catch (error) {
      enqueueToast(error instanceof Error ? error.message : t('actionFailed'));
    }
  }

  function startEditingComment(comment: BoardCanvasComment) {
    setEditingCommentId(comment.id);
    setEditingCommentDraft(comment.body);
  }

  function canEditComment(comment: BoardCanvasComment) {
    return roleCode === 'owner' || roleCode === 'editor' || (roleCode === 'commenter' && comment.userId === currentUserId);
  }

  return (
    <section className="board-comments">
      <h3>{t('commentsHeading')}</h3>
      {selectedComments.length === 0 ? (
        <p className="board-comments-empty">{t('commentsEmpty')}</p>
      ) : (
        <ul className="board-comment-list">
          {selectedComments.map((comment) => (
            <li className="board-comment" key={comment.id}>
              {editingCommentId === comment.id ? (
                <form
                  className="board-comment-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void mutateComment('update', comment.id);
                  }}
                >
                  <textarea
                    id={`comment-edit-${comment.id}`}
                    aria-label={t('commentEditLabel')}
                    value={editingCommentDraft}
                    onChange={(event) => setEditingCommentDraft(event.target.value)}
                    rows={3}
                  />
                  <div className="board-comment-actions">
                    <button className="button button-primary" type="submit">
                      {t('saveComment')}
                    </button>
                    <button
                      className="button button-secondary"
                      onClick={() => {
                        setEditingCommentId(null);
                        setEditingCommentDraft('');
                      }}
                      type="button"
                    >
                      {t('cancelEdit')}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="board-comment-meta">
                    <strong>{comment.userDisplayName}</strong>
                    <span>{new Date(comment.createdAt).toLocaleString()}</span>
                  </p>
                  <p className="board-comment-body">{comment.body}</p>
                  {canEditComment(comment) ? (
                    <div className="board-comment-actions">
                      <button
                        className="button button-secondary"
                        onClick={() => startEditingComment(comment)}
                        type="button"
                      >
                        {t('editComment')}
                      </button>
                      <button
                        className="button button-secondary"
                        onClick={() => void mutateComment('delete', comment.id)}
                        type="button"
                      >
                        {t('deleteComment')}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="board-comment-form"
        onSubmit={(event) => {
          event.preventDefault();
          void mutateComment('create');
        }}
      >
        <textarea
          id="comment-body"
          aria-label={t('commentBodyLabel')}
          disabled={!canCreateComments}
          onChange={(event) => setCommentDraft(event.target.value)}
          placeholder={t('commentPlaceholder')}
          value={commentDraft}
          rows={4}
        />
        <div className="board-comment-actions">
          <button className="button button-primary" disabled={!canCreateComments} type="submit">
            {t('postComment')}
          </button>
        </div>
      </form>
    </section>
  );
}
