package ws

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type Op struct {
	BoardID   string          `json:"boardId"`
	ObjectID  string          `json:"objectId"`
	Property  string          `json:"property"`
	Value     json.RawMessage `json:"value"`
	LamportTS int64           `json:"lamport_ts"`
	ClientID  string          `json:"clientId"`
}

const (
	// MaxObjectIDBytes and MaxClientIDBytes bound two fields that sit outside Value and so
	// are never covered by validatePresenceValue's byte limit. Real object ids are small
	// numeric strings and real client ids are short generated identifiers, so these limits
	// are generous for legitimate use while blocking a client from inflating either field to
	// hundreds of KB to amplify the per-message broadcast/relay cost (see PR #55 review).
	MaxObjectIDBytes = 128
	MaxClientIDBytes = 128
)

func ParseOp(raw []byte) (Op, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return Op{}, fmt.Errorf("op payload is empty")
	}

	if raw[0] == '[' {
		return parseArrayOp(raw)
	}

	return parseObjectOp(raw)
}

func parseObjectOp(raw []byte) (Op, error) {
	type payload struct {
		BoardID      json.RawMessage `json:"boardId"`
		ObjectID     json.RawMessage `json:"objectId"`
		Property     json.RawMessage `json:"property"`
		Value        json.RawMessage `json:"value"`
		LamportTS    json.Number     `json:"lamport_ts"`
		LamportTSAlt json.Number     `json:"lamportTs"`
		ClientID     json.RawMessage `json:"clientId"`
	}

	var decoded payload
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return Op{}, fmt.Errorf("decode op payload: %w", err)
	}

	lamport, err := parseLamport(decoded.LamportTS, decoded.LamportTSAlt)
	if err != nil {
		return Op{}, err
	}

	boardID, err := rawString(decoded.BoardID)
	if err != nil {
		return Op{}, fmt.Errorf("decode boardId: %w", err)
	}
	objectID, err := rawString(decoded.ObjectID)
	if err != nil {
		return Op{}, fmt.Errorf("decode objectId: %w", err)
	}
	property, err := rawString(decoded.Property)
	if err != nil {
		return Op{}, fmt.Errorf("decode property: %w", err)
	}
	clientID, err := rawString(decoded.ClientID)
	if err != nil {
		return Op{}, fmt.Errorf("decode clientId: %w", err)
	}

	return Op{
		BoardID:   boardID,
		ObjectID:  objectID,
		Property:  property,
		Value:     cloneRawMessage(decoded.Value),
		LamportTS: lamport,
		ClientID:  clientID,
	}, nil
}

func parseArrayOp(raw []byte) (Op, error) {
	var parts []json.RawMessage
	if err := json.Unmarshal(raw, &parts); err != nil {
		return Op{}, fmt.Errorf("decode op tuple: %w", err)
	}
	if len(parts) != 6 {
		return Op{}, fmt.Errorf("op tuple must contain 6 items")
	}

	boardID, err := rawString(parts[0])
	if err != nil {
		return Op{}, fmt.Errorf("decode boardId: %w", err)
	}
	objectID, err := rawString(parts[1])
	if err != nil {
		return Op{}, fmt.Errorf("decode objectId: %w", err)
	}
	property, err := rawString(parts[2])
	if err != nil {
		return Op{}, fmt.Errorf("decode property: %w", err)
	}
	lamport, err := rawInt64(parts[4])
	if err != nil {
		return Op{}, fmt.Errorf("decode lamport_ts: %w", err)
	}
	clientID, err := rawString(parts[5])
	if err != nil {
		return Op{}, fmt.Errorf("decode clientId: %w", err)
	}

	return Op{
		BoardID:   boardID,
		ObjectID:  objectID,
		Property:  property,
		Value:     cloneRawMessage(parts[3]),
		LamportTS: lamport,
		ClientID:  clientID,
	}, nil
}

func (op Op) Validate(expectedBoardID string) error {
	switch {
	case op.BoardID == "":
		return fmt.Errorf("boardId is required")
	case op.ObjectID == "":
		return fmt.Errorf("objectId is required")
	case len(op.ObjectID) > MaxObjectIDBytes:
		return fmt.Errorf("objectId must not exceed %d bytes", MaxObjectIDBytes)
	case op.Property == "":
		return fmt.Errorf("property is required")
	case len(op.Value) == 0:
		return fmt.Errorf("value is required")
	case op.LamportTS < 0:
		return fmt.Errorf("lamport_ts must be non-negative")
	case op.ClientID == "":
		return fmt.Errorf("clientId is required")
	case len(op.ClientID) > MaxClientIDBytes:
		return fmt.Errorf("clientId must not exceed %d bytes", MaxClientIDBytes)
	case expectedBoardID != "" && op.BoardID != expectedBoardID:
		return fmt.Errorf("op boardId %q does not match connection boardId %q", op.BoardID, expectedBoardID)
	default:
		if op.Property == "presence" {
			if err := op.validatePresenceValue(); err != nil {
				return err
			}
		}
		return nil
	}
}

func (op Op) MarshalJSON() ([]byte, error) {
	type payload struct {
		BoardID   string          `json:"boardId"`
		ObjectID  string          `json:"objectId"`
		Property  string          `json:"property"`
		Value     json.RawMessage `json:"value"`
		LamportTS int64           `json:"lamport_ts"`
		ClientID  string          `json:"clientId"`
	}

	return json.Marshal(payload{
		BoardID:   op.BoardID,
		ObjectID:  op.ObjectID,
		Property:  op.Property,
		Value:     cloneRawMessage(op.Value),
		LamportTS: op.LamportTS,
		ClientID:  op.ClientID,
	})
}

func parseLamport(values ...json.Number) (int64, error) {
	for _, value := range values {
		if value == "" {
			continue
		}

		lamport, err := value.Int64()
		if err != nil {
			return 0, fmt.Errorf("lamport_ts must be an integer: %w", err)
		}
		return lamport, nil
	}

	return 0, fmt.Errorf("lamport_ts is required")
}

func rawString(raw json.RawMessage) (string, error) {
	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		return value, nil
	}

	var number json.Number
	if err := json.Unmarshal(raw, &number); err == nil {
		return number.String(), nil
	}

	return "", fmt.Errorf("expected string or number, got %s", string(raw))
}

func rawInt64(raw json.RawMessage) (int64, error) {
	var number json.Number
	if err := json.Unmarshal(raw, &number); err == nil {
		return number.Int64()
	}

	var value int64
	if err := json.Unmarshal(raw, &value); err == nil {
		return value, nil
	}

	return 0, fmt.Errorf("expected integer, got %s", string(raw))
}

func cloneRawMessage(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return nil
	}

	clone := make([]byte, len(raw))
	copy(clone, raw)
	return clone
}

type PresenceValue struct {
	Cursor *CursorCoords `json:"cursor"`
}

type CursorCoords struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

func (op Op) validatePresenceValue() error {
	if len(op.Value) == 0 {
		return fmt.Errorf("presence value is required")
	}
	if len(op.Value) > 512 {
		return fmt.Errorf("presence value must not exceed 512 bytes")
	}

	var payload map[string]json.RawMessage
	if err := json.Unmarshal(op.Value, &payload); err != nil {
		return fmt.Errorf("presence value must be an object: %w", err)
	}
	if len(payload) < 1 || len(payload) > 2 {
		return fmt.Errorf("presence value must contain cursor and optional displayName")
	}
	for key := range payload {
		if key != "cursor" && key != "displayName" {
			return fmt.Errorf("presence value must contain only cursor and optional displayName")
		}
	}

	cursorRaw, ok := payload["cursor"]
	if !ok {
		return fmt.Errorf("presence value must include cursor")
	}

	var cursor map[string]json.RawMessage
	if err := json.Unmarshal(cursorRaw, &cursor); err != nil {
		return fmt.Errorf("presence cursor must be an object: %w", err)
	}
	if len(cursor) != 2 {
		return fmt.Errorf("presence cursor must contain only x and y")
	}

	if _, ok := cursor["x"]; !ok {
		return fmt.Errorf("presence cursor must include x")
	}
	if _, ok := cursor["y"]; !ok {
		return fmt.Errorf("presence cursor must include y")
	}

	var x, y float64
	if err := json.Unmarshal(cursor["x"], &x); err != nil {
		return fmt.Errorf("presence cursor.x must be numeric: %w", err)
	}
	if err := json.Unmarshal(cursor["y"], &y); err != nil {
		return fmt.Errorf("presence cursor.y must be numeric: %w", err)
	}

	if displayNameRaw, ok := payload["displayName"]; ok {
		var displayName string
		if err := json.Unmarshal(displayNameRaw, &displayName); err != nil {
			return fmt.Errorf("presence displayName must be a string: %w", err)
		}
	}

	return nil
}
