import test from "node:test";
import assert from "node:assert/strict";
import {
  afterEmailLink, EMAIL_CHANGE_ERRORS, EMAIL_LINK_PAGE, emailChangeFailure, emailChangeProblem, googleButtonPage, isEmailChangeLink, googleReturnFailure, googleSwitchedOn, looksLikeEmail, MIN_PASSWORD_LENGTH, newPasswordFailure, passwordProblem, registerFailure,
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

test("Google sign-in is on only when Supabase's settings say so plainly", () => {
  assert.equal(googleSwitchedOn({ external: { google: true, email: true } }), "on");
  assert.equal(googleSwitchedOn({ external: { google: false, email: true } }), "off");
  // An answer without the switch, or no answer at all, is "could not tell", never "on".
  assert.equal(googleSwitchedOn({ external: { email: true } }), "unknown");
  assert.equal(googleSwitchedOn({ msg: "Invalid API key" }), "unknown");
  assert.equal(googleSwitchedOn(null), "unknown");
  assert.equal(googleSwitchedOn("google"), "unknown");
});

test("a Google sign-in cancelled at Google is told apart from one that failed", () => {
  assert.equal(googleReturnFailure("access_denied", null), "google-cancelled");
  assert.equal(googleReturnFailure("server_error", "access_denied"), "google-cancelled");
  assert.equal(googleReturnFailure("server_error", "unexpected_failure"), "google-failed");
  assert.equal(googleReturnFailure(null, null), "google-failed");
});

test("the Google button's messages only go back to the pages it sits on", () => {
  assert.equal(googleButtonPage("/"), "/");
  assert.equal(googleButtonPage("/register"), "/register");
  assert.equal(googleButtonPage("/sign-in"), "/sign-in");
  assert.equal(googleButtonPage("https://example.com"), "/sign-in");
  assert.equal(googleButtonPage(""), "/sign-in");
});

test("an email-change link comes back to the profile page, however it is marked", () => {
  assert.equal(afterEmailLink("email", null), EMAIL_LINK_PAGE);
  assert.equal(afterEmailLink(null, "email_change"), EMAIL_LINK_PAGE);
  assert.equal(EMAIL_LINK_PAGE, "/profile?email=link");
  // A reset still wins: it is the only link that must reach the password page.
  assert.equal(afterEmailLink("reset", "email_change"), "/reset-password");
  assert.equal(isEmailChangeLink("email", null), true);
  assert.equal(isEmailChangeLink(null, "email_change"), true);
  assert.equal(isEmailChangeLink(null, "signup"), false);
  assert.equal(isEmailChangeLink("https://evil.example", null), false);
});

test("a new email must look like one and differ from the current one", () => {
  assert.equal(emailChangeProblem("new@example.com", "old@example.com"), null);
  assert.equal(emailChangeProblem("new@example.com", null), null);
  assert.equal(emailChangeProblem("not an email", "old@example.com"), "email");
  assert.equal(emailChangeProblem("", "old@example.com"), "email");
  assert.equal(emailChangeProblem("Old@Example.com", "old@example.com"), "same");
});

test("a refused email change is named, never shown as success", () => {
  assert.equal(emailChangeFailure({ code: "email_exists" }), "taken");
  assert.equal(emailChangeFailure({ code: "user_already_exists" }), "taken");
  assert.equal(emailChangeFailure({ code: "email_address_invalid" }), "email");
  assert.equal(emailChangeFailure({ status: 429 }), "rate");
  assert.equal(emailChangeFailure({ code: "over_email_send_rate_limit" }), "rate");
  assert.equal(emailChangeFailure({ code: "session_not_found" }), "signed-out");
  assert.equal(emailChangeFailure({ status: 401 }), "signed-out");
  assert.equal(emailChangeFailure({ code: "unexpected_failure" }), "failed");
  assert.equal(emailChangeFailure({}), "failed");
  for (const text of Object.values(EMAIL_CHANGE_ERRORS)) assert.match(text, /Nothing was changed|nothing was changed/);
  assert.match(EMAIL_CHANGE_ERRORS.taken, /already in use/);
});
