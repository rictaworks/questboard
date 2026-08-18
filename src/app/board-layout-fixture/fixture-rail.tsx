"use client";

import {faGear, faListCheck, faMap, faSliders} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {useState, type ReactNode} from 'react';

// board-canvas-panel.tsx の右端コマンドレール（issue #183）と同じ
// 「1枚だけ開くオーバーレイパネル」を、レイアウト回帰テスト用に最小構成で再現する。
// 本物のクエスト/ミニマップ/詳細ロジックは持たず、渡された静的コンテンツを
// 開閉するだけの薄いラッパーである。
type ActivePanel = 'quests' | 'minimap' | 'details' | 'settings';

type FixtureRailProps = {
  railLabel: string;
  questsLabel: string;
  questsPanel: ReactNode;
  minimapLabel: string;
  minimapPanel: ReactNode;
  detailsLabel: string;
  detailsPanel: ReactNode;
  settingsLabel: string;
  settingsPanel: ReactNode;
  userMenu: ReactNode;
};

export default function FixtureRail({
  railLabel,
  questsLabel,
  questsPanel,
  minimapLabel,
  minimapPanel,
  detailsLabel,
  detailsPanel,
  settingsLabel,
  settingsPanel,
  userMenu
}: FixtureRailProps) {
  // 実測テスト（board-layout-fixture.test.mjs）が各パネルを個別に開いて計測できるよう、
  // 初期状態はミニマップを開いた状態にしておく（何も開いていないと見た目の確認がしづらい）。
  const [activePanel, setActivePanel] = useState<ActivePanel>('minimap');

  function toggle(panel: ActivePanel) {
    setActivePanel((current) => (current === panel ? current : panel));
  }

  return (
    <>
      <nav aria-label={railLabel} className="board-canvas-rail">
        <button
          aria-label={questsLabel}
          aria-pressed={activePanel === 'quests'}
          className="board-canvas-rail-button"
          data-testid="rail-quests"
          onClick={() => toggle('quests')}
          type="button"
        >
          <FontAwesomeIcon icon={faListCheck} />
        </button>
        <button
          aria-label={minimapLabel}
          aria-pressed={activePanel === 'minimap'}
          className="board-canvas-rail-button"
          data-testid="rail-minimap"
          onClick={() => toggle('minimap')}
          type="button"
        >
          <FontAwesomeIcon icon={faMap} />
        </button>
        <button
          aria-label={detailsLabel}
          aria-pressed={activePanel === 'details'}
          className="board-canvas-rail-button"
          data-testid="rail-details"
          onClick={() => toggle('details')}
          type="button"
        >
          <FontAwesomeIcon icon={faSliders} />
        </button>
        <button
          aria-label={settingsLabel}
          aria-pressed={activePanel === 'settings'}
          className="board-canvas-rail-button"
          data-testid="rail-settings"
          onClick={() => toggle('settings')}
          type="button"
        >
          <FontAwesomeIcon icon={faGear} />
        </button>
        {userMenu}
      </nav>

      {activePanel === 'quests' ? questsPanel : null}
      {activePanel === 'minimap' ? minimapPanel : null}
      {activePanel === 'details' ? detailsPanel : null}
      {activePanel === 'settings' ? settingsPanel : null}
    </>
  );
}
