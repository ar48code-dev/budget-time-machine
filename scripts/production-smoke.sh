#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:80/api}"
ROOM_HEADER="${ROOM_HEADER:-the-line-smoke-room}"
WORK_DIR="$(mktemp -d)"
COOKIE_JAR="$WORK_DIR/cookies.txt"
ROOM_A_COOKIES="$WORK_DIR/room-a-cookies.txt"
ROOM_B_COOKIES="$WORK_DIR/room-b-cookies.txt"
trap 'rm -rf "$WORK_DIR"' EXIT

request() {
  curl -fsS --max-time 120 \
    -H "x-production-room: $ROOM_HEADER" \
    -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$@"
}

browser_request() {
  local cookie_jar="$1"
  shift
  curl -fsS --max-time 120 \
    -c "$cookie_jar" -b "$cookie_jar" "$@"
}

browser_status() {
  local cookie_jar="$1"
  shift
  curl -sS --max-time 120 \
    -c "$cookie_jar" -b "$cookie_jar" \
    -o "$WORK_DIR/browser-response.json" -w '%{http_code}' "$@"
}

# Two cookie jars represent two independent browsers. Loading a production in
# browser A must never make it visible to browser B.
browser_request "$ROOM_A_COOKIES" "$BASE_URL/room-context" >"$WORK_DIR/room-a-context.json"
browser_request "$ROOM_B_COOKIES" "$BASE_URL/room-context" >"$WORK_DIR/room-b-context.json"
room_a_id="$(jq -r '.room.roomId' "$WORK_DIR/room-a-context.json")"
room_b_id="$(jq -r '.room.roomId' "$WORK_DIR/room-b-context.json")"
test -n "$room_a_id" && test "$room_a_id" != "null"
test -n "$room_b_id" && test "$room_b_id" != "null"
test "$room_a_id" != "$room_b_id"
browser_request "$ROOM_A_COOKIES" "$BASE_URL/sample" >/dev/null
browser_b_graph_status="$(browser_status "$ROOM_B_COOKIES" "$BASE_URL/graph")"
test "$browser_b_graph_status" = "404"
browser_request "$ROOM_A_COOKIES" "$BASE_URL/graph" >"$WORK_DIR/room-a-graph.json"
jq -e '.productionName and (.days | length > 0)' "$WORK_DIR/room-a-graph.json" >/dev/null

request -X POST "$BASE_URL/reset" >/dev/null
request "$BASE_URL/sample" >"$WORK_DIR/sample.json"
jq -e '.graph.productionName and (.graph.days | length > 0)' "$WORK_DIR/sample.json" >/dev/null

day_id="$(jq -r '.graph.days[0].id' "$WORK_DIR/sample.json")"
scene="$(jq -r '.graph.days[0].scenes[0]' "$WORK_DIR/sample.json")"
request -X POST "$BASE_URL/simulate" \
  -H 'content-type: application/json' \
  -d "$(jq -nc --arg day "$day_id" --arg scene "$scene" \
    '{dayId:$day,changeType:"cut_scene",details:{sceneToCut:$scene}}')" \
  >"$WORK_DIR/simulation.json"
jq -e '.changeId and .cascade and .impact' "$WORK_DIR/simulation.json" >/dev/null

change_id="$(jq -r '.changeId' "$WORK_DIR/simulation.json")"
confirmation_status="$(curl -sS --max-time 120 -o "$WORK_DIR/confirmation.json" -w '%{http_code}' \
  -H "x-production-room: $ROOM_HEADER" \
  -H 'content-type: application/json' \
  -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -d "$(jq -nc --arg id "$change_id" '{changeId:$id,confirmed:false}')" \
  "$BASE_URL/apply")"
test "$confirmation_status" = "403"

request -X POST "$BASE_URL/apply" \
  -H 'content-type: application/json' \
  -d "$(jq -nc --arg id "$change_id" '{changeId:$id,confirmed:true}')" \
  >"$WORK_DIR/applied.json"
jq -e '.graph and .producerMemo and (.purchaseOrderDeltas | type == "array")' "$WORK_DIR/applied.json" >/dev/null

request "$BASE_URL/export" >"$WORK_DIR/export.zip"
unzip -tq "$WORK_DIR/export.zip"
for entry in active-production-graph.json decision-log.json applied-plans.json scenarios.json README.md; do
  unzip -Z1 "$WORK_DIR/export.zip" | grep -Fx "$entry" >/dev/null
done

request "$BASE_URL/graph" >"$WORK_DIR/persisted.json"
jq -e '.productionName and (.days | length > 0)' "$WORK_DIR/persisted.json" >/dev/null

echo "The Line smoke test passed: cross-browser isolation, simulation, confirmation gate, apply, export, and room persistence."