package ilink

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"
)

// QRBotType is the bot_type query parameter the QR endpoint expects. The
// upstream constant is "3" and there is no documented meaning; we mirror
// it verbatim.
const QRBotType = "3"

// MaxQRRefreshes mirrors the upstream MAX_QR_REFRESH_COUNT. After this many
// expirations the bind flow gives up.
const MaxQRRefreshes = 3

// QRPollInterval is how long to wait between status polls when the server
// is responding promptly. Long-poll usually blocks long enough that this
// only matters when the server immediately returns "wait".
const QRPollInterval = 1 * time.Second

// QRBindTimeout is the default ceiling for the entire scan-to-confirm
// flow, mirroring the upstream 8-minute window.
const QRBindTimeout = 8 * time.Minute

// QRCode is what callers need to display the user a scannable code.
//
// ImgContent is a URL string. To make it scannable, the caller renders it
// as a QR image (terminal ASCII via qrterminal, or PNG via go-qrcode).
// WeChat scanning the resulting image reads the URL and follows the bind.
type QRCode struct {
	Token      string    // opaque, used to poll status
	ImgContent string    // URL the QR encodes
	IssuedAt   time.Time
}

// GenerateQR fetches a fresh QR code from the well-known login host. This
// always uses FixedQRBaseURL — the per-account messaging BaseURL is not
// available yet at this point in the bind flow.
func (c *Client) GenerateQR(ctx context.Context) (*QRCode, error) {
	endpoint := "ilink/bot/get_bot_qrcode?bot_type=" + url.QueryEscape(QRBotType)
	var resp QRCodeResp
	if err := c.getJSON(ctx, FixedQRBaseURL, endpoint, &resp, c.apiTimeout, "get_bot_qrcode"); err != nil {
		return nil, fmt.Errorf("ilink: get_bot_qrcode: %w", err)
	}
	if resp.Qrcode == "" {
		return nil, errors.New("ilink: get_bot_qrcode returned empty token")
	}
	c.logger.Info("ilink QR code issued", "imgContentLen", len(resp.QrcodeImgContent))
	return &QRCode{
		Token:      resp.Qrcode,
		ImgContent: resp.QrcodeImgContent,
		IssuedAt:   time.Now(),
	}, nil
}

// BindResult is what WaitForBind returns on success: the four credentials
// the caller must persist.
type BindResult struct {
	Credentials Credentials
}

// BindEvent is delivered to the WaitForBind callback so the caller can
// drive UI updates ("scanned, please confirm in WeChat", "QR refreshed",
// etc).
type BindEvent struct {
	Status   QRStatus
	Refresh  *QRCode // populated only when the QR was refreshed mid-flow
	Redirect string  // populated when the polling host changed
}

// BindCallback receives bind progress events. Implementations are called
// from the polling goroutine and should return quickly. nil is allowed.
type BindCallback func(BindEvent)

// WaitForBind drives the QR-status state machine until one of:
//
//   - confirmed (returns *BindResult, nil)
//   - context cancelled or QRBindTimeout elapsed (returns nil, ctx.Err()
//     or os timeout error)
//   - max refreshes exceeded (returns nil, error)
//   - server returns an unrecoverable HTTP error (returns nil, error)
//
// On confirmation the Client is automatically primed with the new
// credentials via SetCredentials, so the same Client instance can
// immediately start polling and sending.
//
// The callback is invoked on every state transition.
func (c *Client) WaitForBind(ctx context.Context, code *QRCode, cb BindCallback) (*BindResult, error) {
	if code == nil || code.Token == "" {
		return nil, errors.New("ilink: WaitForBind requires a non-nil QRCode")
	}

	// pollHost may change mid-flow on a scaned_but_redirect event. Start
	// at the well-known QR host.
	pollHost := FixedQRBaseURL
	currentToken := code.Token
	refreshes := 1

	deadline := time.Now().Add(QRBindTimeout)
	if dctx, ok := ctx.Deadline(); ok && dctx.Before(deadline) {
		deadline = dctx
	}

	for time.Now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		status, err := c.pollQRStatus(ctx, pollHost, currentToken)
		if err != nil {
			// Network/gateway hiccups during the QR poll are treated as
			// "wait" upstream — we mirror that to avoid aborting on
			// transient Cloudflare 524s and similar.
			if IsTimeout(err) {
				c.logger.Debug("ilink QR poll timeout, will retry", "err", err)
				continue
			}
			c.logger.Warn("ilink QR poll network error, retrying", "err", err)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(QRPollInterval):
			}
			continue
		}

		if cb != nil {
			cb(BindEvent{Status: status.Status})
		}

		switch status.Status {
		case QRStatusWait, QRStatusScaned:
			// keep polling
		case QRStatusScanedButRedirect:
			if status.RedirectHost == "" {
				c.logger.Warn("ilink scaned_but_redirect without redirect_host")
				break
			}
			newHost := "https://" + status.RedirectHost
			c.logger.Info("ilink IDC redirect", "host", newHost)
			pollHost = newHost
			if cb != nil {
				cb(BindEvent{Status: status.Status, Redirect: newHost})
			}
		case QRStatusExpired:
			refreshes++
			if refreshes > MaxQRRefreshes {
				return nil, fmt.Errorf("ilink: QR expired %d times, giving up", MaxQRRefreshes)
			}
			c.logger.Info("ilink QR expired, refreshing", "attempt", refreshes)
			fresh, err := c.GenerateQR(ctx)
			if err != nil {
				return nil, fmt.Errorf("ilink: refresh QR: %w", err)
			}
			currentToken = fresh.Token
			if cb != nil {
				cb(BindEvent{Status: QRStatusExpired, Refresh: fresh})
			}
		case QRStatusConfirmed:
			if status.ILinkBotID == "" {
				return nil, errors.New("ilink: confirmed status missing ilink_bot_id")
			}
			creds := Credentials{
				BotToken:    status.BotToken,
				ILinkBotID:  status.ILinkBotID,
				ILinkUserID: status.ILinkUserID,
				BaseURL:     status.BaseURL,
			}
			c.SetCredentials(creds)
			c.logger.Info("ilink bind confirmed",
				"bot_id", status.ILinkBotID,
				"base_url", status.BaseURL,
			)
			return &BindResult{Credentials: creds}, nil
		default:
			c.logger.Warn("ilink unknown QR status", "status", string(status.Status))
		}

		// Polite gap between long-poll iterations. The server typically
		// holds the request long enough that this is a no-op; it only
		// matters if the server immediately returns "wait".
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(QRPollInterval):
		}
	}

	return nil, errors.New("ilink: bind timed out, please retry")
}

// pollQRStatus issues a single long-poll get_qrcode_status request.
func (c *Client) pollQRStatus(ctx context.Context, baseURL, token string) (*QRStatusResp, error) {
	endpoint := "ilink/bot/get_qrcode_status?qrcode=" + url.QueryEscape(token)
	var resp QRStatusResp
	if err := c.getJSON(ctx, baseURL, endpoint, &resp, c.longPollTimeout, "get_qrcode_status"); err != nil {
		return nil, err
	}
	return &resp, nil
}
