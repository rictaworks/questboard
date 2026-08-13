"use client";

import {faCircleExclamation, faSpinner} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {useTranslations} from "next-intl";

type PlanUnavailablePanelProps = {
  errorMessage: string | null;
  onManualRecheck: () => Promise<void>;
  rechecking: boolean;
};

export default function PlanUnavailablePanel({
  errorMessage,
  onManualRecheck,
  rechecking
}: PlanUnavailablePanelProps) {
  const t = useTranslations("Auth");

  return (
    <section className="board-panel" aria-live="polite">
      <p className="auth-status">
        <FontAwesomeIcon icon={faCircleExclamation} />
        <span>{t("unavailableHeading")}</span>
      </p>
      <p className="board-copy">{t("unavailableDescription")}</p>
      <p className="board-copy">{t("unavailableFollowGuide")}</p>
      {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
      <button className="button button-primary auth-button" disabled={rechecking} type="button" onClick={() => void onManualRecheck().catch(() => undefined)}>
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
