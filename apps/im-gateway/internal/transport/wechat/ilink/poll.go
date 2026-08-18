package ilink

import (
	"context"
	"fmt"
)

// GetUpdates issues one long-poll request for inbound messages.
//
// Returns:
//
//   - (resp, nil): success. resp.Msgs is the batch (possibly empty) and
//     resp.GetUpdatesBuf is the cursor the caller MUST persist before the
//     next call.
//   - (resp_with_empty_msgs, nil): server-side or client-side timeout. The
//     long-poll returned no data; caller should immediately retry without
//     touching the cursor. The returned struct preserves the inbound
//     cursor so the caller's "save buf after every call" loop is safe.
//   - (nil, ErrSessionTimeout): bot token is dead, re-bind required.
//   - (nil, ErrCredentialsMissing): client was never bound.
//   - (nil, other error): real failure (HTTP, JSON, network).
//
// Long-poll timeouts are deliberately mapped to a non-error return so the
// outer poll loop can stay in a tight `for { GetUpdates(...) }` shape and
// not have to special-case the timeout path.
func (c *Client) GetUpdates(ctx context.Context, cursor string) (*GetUpdatesResp, error) {
	baseURL := c.MessagingBaseURL()
	if baseURL == "" || c.botTokenValue() == "" {
		return nil, ErrCredentialsMissing
	}

	body := GetUpdatesReq{
		GetUpdatesBuf: cursor,
		BaseInfo:      c.baseInfo(),
	}

	var resp GetUpdatesResp
	err := c.postJSON(ctx, baseURL, "ilink/bot/getupdates", body, &resp, c.longPollTimeout, "getupdates")
	if err != nil {
		if IsTimeout(err) {
			// Long-poll timeout is normal — return an empty response
			// echoing the existing cursor so the caller's persistence
			// step is a no-op.
			c.logger.Debug("ilink getupdates long-poll timed out, retrying")
			return &GetUpdatesResp{GetUpdatesBuf: cursor}, nil
		}
		return nil, err
	}

	// errcode -14 = bot session timeout. The token is dead and the user
	// must re-scan. We return a sentinel error so the upper layer knows
	// to stop polling and surface a re-bind prompt.
	if resp.ErrCode == -14 {
		return nil, fmt.Errorf("%w: %s", ErrSessionTimeout, resp.ErrMsg)
	}
	if resp.ErrCode != 0 || resp.Ret != 0 {
		return nil, fmt.Errorf("ilink: getupdates ret=%d errcode=%d errmsg=%q",
			resp.Ret, resp.ErrCode, resp.ErrMsg)
	}

	return &resp, nil
}
