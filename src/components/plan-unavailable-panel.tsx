"use client";

import {faCircleExclamation, faSpinner} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {useTranslations} from "next-intl";

import {buildXProfileUrl, readFollowTargetHandle} from "@/lib/x-auth";

type PlanUnavailablePanelProps = {
  errorMessage: string | null;
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
  headingId,
  headingLevel: Heading,
  onManualRecheck,
  rechecking
}: PlanUnavailablePanelProps) {
  const t = useTranslations("Auth");
  const handle = readFollowTargetHandle();
  const mention = `@${handle}`;

  return (
    <section className="board-panel" aria-live="polite">
      <Heading id={headingId}>
        <FontAwesomeIcon icon={faCircleExclamation} />
        <span>{t("unavailableHeading")}</span>
      </Heading>
      <p className="board-copy">{t("unavailableDescription")}</p>
      <p className="board-copy">{t("unavailableFollowGuide", {handle: mention})}</p>
      <p className="board-copy">
        <a href={buildXProfileUrl(handle)} rel="noopener noreferrer" target="_blank">
          {t("unavailableFollowLink", {handle: mention})}
        </a>
      </p>
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
