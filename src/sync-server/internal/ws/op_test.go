package ws

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseOpSupportsTupleFormat(t *testing.T) {
	op, err := ParseOp([]byte(`["board-1","object-2","color",{"hex":"#fff"},12,"client-a"]`))
	if err != nil {
		t.Fatalf("ParseOp() error = %v", err)
	}

	if op.BoardID != "board-1" || op.ObjectID != "object-2" || op.Property != "color" || op.LamportTS != 12 || op.ClientID != "client-a" {
		t.Fatalf("ParseOp() = %#v", op)
	}

	if string(op.Value) != `{"hex":"#fff"}` {
		t.Fatalf("ParseOp() Value = %s, want object payload", op.Value)
	}
}

func TestOpMarshalJSONPreservesValuePayload(t *testing.T) {
	op := Op{
		BoardID:   "board-1",
		ObjectID:  "object-2",
		Property:  "text_crdt",
		Value:     json.RawMessage(`{"ops":[{"insert":"hi"}]}`),
		LamportTS: 13,
		ClientID:  "client-a",
	}

	raw, err := op.MarshalJSON()
	if err != nil {
		t.Fatalf("MarshalJSON() error = %v", err)
	}

	if string(raw) != `{"boardId":"board-1","objectId":"object-2","property":"text_crdt","value":{"ops":[{"insert":"hi"}]},"lamport_ts":13,"clientId":"client-a"}` {
		t.Fatalf("MarshalJSON() = %s", raw)
	}
}

func TestValidateRejectsOversizedObjectAndClientIDs(t *testing.T) {
	base := Op{
		BoardID:   "board-1",
		ObjectID:  "object-1",
		Property:  "geometry",
		Value:     json.RawMessage(`{"x":1}`),
		LamportTS: 1,
		ClientID:  "client-1",
	}

	oversizedObjectID := base
	oversizedObjectID.ObjectID = strings.Repeat("o", MaxObjectIDBytes+1)
	if err := oversizedObjectID.Validate(""); err == nil {
		t.Fatal("Validate() error = nil, want an error for an objectId exceeding MaxObjectIDBytes")
	}

	oversizedClientID := base
	oversizedClientID.ClientID = strings.Repeat("c", MaxClientIDBytes+1)
	if err := oversizedClientID.Validate(""); err == nil {
		t.Fatal("Validate() error = nil, want an error for a clientId exceeding MaxClientIDBytes")
	}

	// Values right at the limit must still be accepted.
	atLimit := base
	atLimit.ObjectID = strings.Repeat("o", MaxObjectIDBytes)
	atLimit.ClientID = strings.Repeat("c", MaxClientIDBytes)
	if err := atLimit.Validate(""); err != nil {
		t.Fatalf("Validate() error = %v, want nil for objectId/clientId exactly at the limit", err)
	}
}
