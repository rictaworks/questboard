"use client";

import {faClone, faComment, faFont, faLock, faNoteSticky, faPalette, faShapes, faSquareFull, faTrashCan, faUnlock, faXmark, type IconDefinition} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {useEffect} from 'react';
import {useTranslations} from 'next-intl';

import type {RadialMenuItem} from '@/lib/radial-menu';

// モック（app-ui/Questboard Prototype.dc.html）のラジアルメニュー寸法。
// 中心から半径 100px の円周上に 56px の円形ボタンを等間隔で並べ、
// 中心に閉じるボタン（48px）を置く。
const RADIAL_RADIUS_PX = 100;
const RADIAL_ITEM_SIZE_PX = 56;
const RADIAL_CENTER_SIZE_PX = 48;
// 画面端で開いたときに項目が見切れないよう、中心点をこの余白ぶん内側へ寄せる。
const RADIAL_EDGE_MARGIN_PX = RADIAL_RADIUS_PX + RADIAL_ITEM_SIZE_PX;

const RADIAL_ITEM_ICONS: Record<string, IconDefinition> = {
  'create-frame': faSquareFull,
  'create-shape': faShapes,
  'create-sticky': faNoteSticky,
  'create-text': faFont,
  color: faPalette,
  comment: faComment,
  delete: faTrashCan,
  duplicate: faClone,
  lock: faLock,
  unlock: faUnlock,
};

type BoardRadialMenuProps = {
  x: number;
  y: number;
  items: RadialMenuItem[];
  showLockedNote: boolean;
  onSelect: (item: RadialMenuItem) => void;
  onClose: () => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export default function BoardRadialMenu({x, y, items, showLockedNote, onSelect, onClose}: BoardRadialMenuProps) {
  const t = useTranslations('BoardCanvas');

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const centerX = clamp(x, RADIAL_EDGE_MARGIN_PX, Math.max(RADIAL_EDGE_MARGIN_PX, window.innerWidth - RADIAL_EDGE_MARGIN_PX));
  const centerY = clamp(y, RADIAL_EDGE_MARGIN_PX, Math.max(RADIAL_EDGE_MARGIN_PX, window.innerHeight - RADIAL_EDGE_MARGIN_PX));

  return (
    <div
      className="board-radial-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="menu"
      aria-label={t('canvasLabel')}
    >
      {items.map((item, index) => {
        // モックと同じく真上（-90°）から時計回りに等間隔で配置する。
        const angle = -Math.PI / 2 + index * ((2 * Math.PI) / items.length);
        const itemX = centerX + Math.cos(angle) * RADIAL_RADIUS_PX - RADIAL_ITEM_SIZE_PX / 2;
        const itemY = centerY + Math.sin(angle) * RADIAL_RADIUS_PX - RADIAL_ITEM_SIZE_PX / 2;
        const label = t(item.labelKey as never);

        return (
          <button
            className="board-radial-item"
            key={item.key}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(item);
            }}
            role="menuitem"
            style={{left: `${itemX}px`, top: `${itemY}px`}}
            type="button"
          >
            <FontAwesomeIcon icon={RADIAL_ITEM_ICONS[item.key] ?? faShapes} />
            <span>{label}</span>
          </button>
        );
      })}
      <button
        aria-label={t('radialClose')}
        className="board-radial-center"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        style={{
          left: `${centerX - RADIAL_CENTER_SIZE_PX / 2}px`,
          top: `${centerY - RADIAL_CENTER_SIZE_PX / 2}px`,
        }}
        type="button"
      >
        <FontAwesomeIcon icon={faXmark} />
      </button>
      {showLockedNote ? (
        <p className="board-radial-note" style={{left: `${centerX}px`, top: `${centerY + RADIAL_RADIUS_PX + RADIAL_ITEM_SIZE_PX / 2}px`}}>
          {t('radialLockedNote')}
        </p>
      ) : null}
    </div>
  );
}
