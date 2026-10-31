import test from "node:test";
import assert from "node:assert/strict";
import {
  afterEmailLink, looksLikeEmail, MIN_PASSWORD_LENGTH, newPasswordFailure, passwordProblem, registerFailure,
  resetFailure, signInFailure,
} from "./authErrors.ts";

test("an email address needs a name, an @ and a domain", () => {
  assert.equal(looksLikeEmail("dane@example.com"), true);
  assert.equal(looksLikeEmail("dane@example"), false);
  assert.equal(looksLikeEmail("dane example.com"), false);
  assert.equal(looksLikeEmail(""), false);
});

test("a new password must be long enough and typed the same twice", () => {
  const ok = "x".repeat(MIN_PASSWORD_LENGTH);
  assert.equal(passwordProblem(ok, ok), null);
  assert.equal(passwordProblem(ok.slice(1), ok.slice(1)), "short");
  assert.equal(passwordProblem(ok, `${ok}y`), "mismatch");
  // Too short is said first: there is no point matching a password that will be refused.
  assert.equal(passwordProblem("abc", "abd"), "short");
});

test("registering with an email already in use says so", () => {
  assert.equal(registerFailure({ code: "user_already_exists" }), "taken");
  assert.equal(registerFailure({ code: "email_exists" }), "taken");
  assert.equal(registerFailure({ code: "weak_password" }), "short");
  assert.equal(registerFailure({ status: 429, code: "over_email_send_rate_limit" }), "rate");
  assert.equal(registerFailure({ status: 500, code: "unexpected_failure" }), "send");
});

test("a wrong password and an unconfirmed email are told apart", () => {
  assert.equal(signInFailure({ status: 400, code: "invalid_credentials" }), "mismatch");
  assert.equal(signInFailure({ status: 400, code: "email_not_confirmed" }), "unconfirmed");
  assert.equal(signInFailure({ status: 429 }), "rate");
  assert.equal(signInFailure({ status: 500 }), "failed");
});

test("a reset email that could not be sent says why", () => {
  assert.equal(resetFailure({ status: 429 }), "rate");
  assert.equal(resetFailure({ status: 500 }), "send");
});

test("saving a new password names the problem", () => {
  assert.equal(newPasswordFailure({ code: "same_password" }), "same");
  assert.equal(newPasswordFailure({ code: "weak_password" }), "short");
  assert.equal(newPasswordFailure({ code: "session_not_found" }), "expired");
  assert.equal(newPasswordFailure({ status: 500 }), "failed");
});

test("only a reset link goes on to the set-a-new-password page", () => {
  assert.equal(afterEmailLink("reset", null), "/reset-password");
  assert.equal(afterEmailLink(null, "recovery"), "/reset-password");
  assert.equal(afterEmailLink(null, "signup"), "/");
  assert.equal(afterEmailLink(null, null), "/");
  // Anything else in ?next= is ignored, so a link cannot point off the site.
  assert.equal(afterEmailLink("https://evil.example", null), "/");
});
