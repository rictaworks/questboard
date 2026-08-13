"use client";

import {faCircleExclamation, faSpinner} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {useTranslations} from "next-intl";

import {buildXProfileUrl} from "@/lib/x-auth";

type PlanUnavailablePanelProps = {
  errorMessage: string | null;
  // フォロー対象のハンドル（先頭の @ は含まない）。ここで環境変数を読むと、未設定時の
  // 例外がレンダー中に投げられ、src/app に error.tsx が無いため none プランの利用者にだけ
  // ページ全体が壊れて出る。解決は呼び出し側の try/catch がある経路で行い、値だけ受け取る。
  //
  // 解決できなかった場合は null を受け取り、案内文を出さずに errorMessage を見せる。
  // 呼び出し側で「ハンドルがあるときだけ利用不可画面を出す」と書くと、環境変数の
  // 設定漏れがそのまま機能の露出（fail-open）になるため、分岐はこちらに寄せる。
  followTargetHandle: string | null;
  // 親セクションの aria-labelledby が参照するID。参照先が存在しないと
  // スクリーンリーダーでセクション名が失われるため、呼び出し側が必ず渡す。
  headingId: string;
  // 見出しの階層はページごとに異なる。トップページは製品名の h1 が既にあるので h2、
  // 共有URLのページはページレベルの h1 を持たず各分岐が自前で出しているので h1。
  // 固定にすると、どちらかのページで見出し階層が飛ぶ。
  headingLevel: "h1" | "h2";
  onManualRecheck: () => Promise<void>;
  rechecking: boolean;
};

export default function PlanUnavailablePanel({
  errorMessage,
  followTargetHandle,
  headingId,
  headingLevel: Heading,
  onManualRecheck,
  rechecking
}: PlanUnavailablePanelProps) {
  const t = useTranslations("Auth");
  const mention = followTargetHandle === null ? null : `@${followTargetHandle}`;

  return (
    <section className="board-panel" aria-live="polite">
      <Heading id={headingId}>
        <FontAwesomeIcon icon={faCircleExclamation} />
        <span>{t("unavailableHeading")}</span>
      </Heading>
      <p className="board-copy">{t("unavailableDescription")}</p>
      {followTargetHandle !== null && mention !== null ? (
        <>
          <p className="board-copy">{t("unavailableFollowGuide", {handle: mention})}</p>
          {/* globals.css の `a { color: inherit; text-decoration: none; }` により、素の <a> は
              本文と見分けがつかない。この画面はフォローへ誘導することが唯一の出口なので、
              board-create-panel.tsx のログイン導線と同じボタン表現に揃える。 */}
          <a
            className="button button-secondary auth-button"
            href={buildXProfileUrl(followTargetHandle)}
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("unavailableFollowLink", {handle: mention})}
          </a>
        </>
      ) : null}
      {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
      <button className="button button-primary auth-button" disabled={rechecking} type="button" onClick={() => void onManualRecheck()}>
        {rechecking ? (
          <>
            <FontAwesomeIcon icon={faSpinner} spin />
            <span>{t("manualRecheckingButton")}</span>
          </>
        ) : (
          <span>{t("manualRecheckButton")}</span>
        )}
      </button>
    </section>
  );
}
