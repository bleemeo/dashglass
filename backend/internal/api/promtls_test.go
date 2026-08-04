package api

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func mustTarget(t *testing.T, rawURL, bearer string, headers map[string]string, tlsOptions PromTLS) *promTarget {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	target, err := newPromTarget(parsed, bearer, headers, tlsOptions)
	if err != nil {
		t.Fatal(err)
	}
	return target
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"success"}`))
	})
}

// serverCertPEM extracts the httptest server's self-signed certificate.
func serverCertPEM(server *httptest.Server) []byte {
	return pem.EncodeToMemory(&pem.Block{
		Type: "CERTIFICATE", Bytes: server.Certificate().Raw,
	})
}

func TestProbeTLSVerification(t *testing.T) {
	server := httptest.NewTLSServer(okHandler())
	defer server.Close()

	// Self-signed upstream: refused with a default transport.
	target := mustTarget(t, server.URL, "", nil, PromTLS{})
	if ok, _ := probePrometheus(context.Background(), target); ok {
		t.Fatal("a self-signed upstream should fail verification by default")
	}

	// insecure_skip_verify bypasses verification.
	target = mustTarget(t, server.URL, "", nil, PromTLS{InsecureSkipVerify: true})
	if ok, reason := probePrometheus(context.Background(), target); !ok {
		t.Fatalf("insecure_skip_verify should reach the upstream: %s", reason)
	}

	// Trusting the server certificate as a CA verifies properly.
	target = mustTarget(t, server.URL, "", nil, PromTLS{CACert: serverCertPEM(server)})
	if ok, reason := probePrometheus(context.Background(), target); !ok {
		t.Fatalf("a custom CA should reach the upstream: %s", reason)
	}
}

// selfSignedPair generates a throwaway self-signed certificate usable as
// both a client certificate and the CA that vouches for it.
func selfSignedPair(t *testing.T) (certPEM, keyPEM []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "dashglass-test-client"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	return certPEM, keyPEM
}

func TestProbeMutualTLS(t *testing.T) {
	clientCert, clientKey := selfSignedPair(t)
	clientCAs := x509.NewCertPool()
	if !clientCAs.AppendCertsFromPEM(clientCert) {
		t.Fatal("failed to build the client CA pool")
	}

	server := httptest.NewUnstartedServer(okHandler())
	server.TLS = &tls.Config{
		ClientAuth: tls.RequireAndVerifyClientCert,
		ClientCAs:  clientCAs,
	}
	server.StartTLS()
	defer server.Close()

	trust := PromTLS{CACert: serverCertPEM(server)}

	// Without a client certificate the handshake is refused.
	target := mustTarget(t, server.URL, "", nil, trust)
	if ok, _ := probePrometheus(context.Background(), target); ok {
		t.Fatal("an mTLS upstream should refuse a certificate-less client")
	}

	// With the pair, the request goes through.
	trust.ClientCert, trust.ClientKey = clientCert, clientKey
	target = mustTarget(t, server.URL, "", nil, trust)
	if ok, reason := probePrometheus(context.Background(), target); !ok {
		t.Fatalf("mTLS with a valid client pair should succeed: %s", reason)
	}
}

func TestCustomHeaders(t *testing.T) {
	var seen http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.Header.Clone()
		w.Write([]byte(`{"status":"success"}`))
	}))
	defer server.Close()

	headers := map[string]string{
		"X-Scope-OrgID": "tenant-1",
		"Authorization": "Custom scheme-nobody-knows",
	}

	// Auth "none": custom headers pass through, including Authorization.
	target := mustTarget(t, server.URL, "", headers, PromTLS{})
	if ok, reason := probePrometheus(context.Background(), target); !ok {
		t.Fatal(reason)
	}
	if seen.Get("X-Scope-OrgID") != "tenant-1" {
		t.Fatalf("X-Scope-OrgID not forwarded, got %q", seen.Get("X-Scope-OrgID"))
	}
	if seen.Get("Authorization") != "Custom scheme-nobody-knows" {
		t.Fatalf("custom Authorization not forwarded, got %q", seen.Get("Authorization"))
	}

	// Configured credentials win over a custom Authorization header.
	target = mustTarget(t, server.URL, "token-1", headers, PromTLS{})
	if ok, reason := probePrometheus(context.Background(), target); !ok {
		t.Fatal(reason)
	}
	if seen.Get("Authorization") != "Bearer token-1" {
		t.Fatalf("bearer should win over the custom header, got %q", seen.Get("Authorization"))
	}
}

func TestBuildTargetTLSValidation(t *testing.T) {
	base := datasourceBody{URL: "https://prom.example.com"}

	forbidden := base
	forbidden.Headers = map[string]string{"Cookie": "nope"}
	if _, err := buildTarget(forbidden, nil); err == nil {
		t.Error("overriding Cookie should be refused")
	}

	badCA := base
	badCA.CACert = "not a pem"
	if _, err := buildTarget(badCA, nil); err == nil {
		t.Error("a bad CA PEM should be refused")
	}

	certPEM, keyPEM := selfSignedPair(t)
	orphanCert := base
	orphanCert.ClientCert = string(certPEM)
	if _, err := buildTarget(orphanCert, nil); err == nil {
		t.Error("a client certificate without its key should be refused")
	}

	// The write-only client key is inherited when the certificate is
	// unchanged.
	full := base
	full.ClientCert, full.ClientKey = string(certPEM), string(keyPEM)
	previous, err := buildTarget(full, nil)
	if err != nil {
		t.Fatalf("valid client pair refused: %v", err)
	}
	edited := base
	edited.URL = "https://other.example.com"
	edited.ClientCert = string(certPEM)
	target, err := buildTarget(edited, previous)
	if err != nil {
		t.Fatalf("unchanged cert with empty key should inherit the stored key: %v", err)
	}
	if string(target.tls.ClientKey) != strings.TrimSpace(string(keyPEM)) {
		t.Error("stored client key not inherited")
	}

	// The comparison is whitespace-insensitive: a cert stored via the
	// raw API (trailing newline) still matches the UI's trimmed paste.
	trimmedEdit := base
	trimmedEdit.ClientCert = strings.TrimSpace(string(certPEM))
	if _, err := buildTarget(trimmedEdit, previous); err != nil {
		t.Errorf("trimmed cert should inherit the stored key: %v", err)
	}
}

func TestHeaderValidation(t *testing.T) {
	build := func(headers map[string]string) error {
		parsed, _ := url.Parse("https://prom.example.com")
		_, err := newPromTarget(parsed, "", headers, PromTLS{})
		return err
	}
	if err := build(map[string]string{"X Scope OrgID": "t1"}); err == nil {
		t.Error("a header name with a space should be refused")
	}
	if err := build(map[string]string{"X-Tenant": "a\r\nInjected: b"}); err == nil {
		t.Error("a header value with control characters should be refused")
	}
	if err := build(map[string]string{"Te": "gzip"}); err == nil {
		t.Error("hop-by-hop headers should be refused")
	}
	if err := build(map[string]string{
		"x-scope-orgid": "tenant-a",
		"X-Scope-OrgID": "tenant-b",
	}); err == nil {
		t.Error("case-duplicate header names should be refused")
	}
	if err := build(map[string]string{"x-scope-orgid": "tenant-1"}); err != nil {
		t.Errorf("a valid lowercase header should pass: %v", err)
	}
}

func TestNewDegradesOnBadStateTarget(t *testing.T) {
	parsed, _ := url.Parse("https://prom.example.com")
	options := Options{
		PrometheusURL: parsed,
		PrometheusTLS: PromTLS{CACert: []byte("not a pem")},
	}

	// State-sourced (not provisioned): boot unconfigured, fixable from
	// the admin UI.
	server, err := New(options)
	if err != nil {
		t.Fatalf("state-sourced bad TLS material must not prevent boot: %v", err)
	}
	if server.prom.Load() != nil {
		t.Fatal("the invalid target should have been dropped")
	}

	// Provisioned: the deployment owns it, fail fast.
	options.PrometheusProvisioned = true
	if _, err := New(options); err == nil {
		t.Fatal("provisioned bad TLS material should fail startup")
	}
}
