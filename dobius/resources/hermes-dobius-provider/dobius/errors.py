"""An upstream account failure must never bench the non-secret adapter marker."""

from .catalog import model_rejected


class DobiusAccountError(RuntimeError):
    pass


def account_failure(error):
    status = getattr(error, "status_code", None)
    if model_rejected(error):
        return DobiusAccountError("The selected Dobius account cannot use this model. Choose another model or account.")
    if status in (402, 429):
        return DobiusAccountError("The selected Dobius account has reached its usage allowance. Switch accounts in Dobius or wait for its allowance to renew.")
    if status in (401, 403):
        return DobiusAccountError("The selected Dobius account needs attention. Sign in again or select another account in Dobius.")
    return None


def classify(error, **kwargs):
    if isinstance(error, DobiusAccountError):
        return {"reason": "format_error", "retryable": False,
                "should_rotate_credential": False, "should_fallback": False}
    return None
