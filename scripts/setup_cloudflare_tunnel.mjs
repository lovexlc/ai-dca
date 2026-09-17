// Automated Cloudflare Tunnel Setup & Verification Script
import fs from 'fs';

const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const MANUAL_TOKEN = process.env.CLOUDFLARE_TUNNEL_TOKEN;
const DOMAIN = 'cn.freebacktrack.tech';
const ZONE_NAME = 'freebacktrack.tech';
const TUNNEL_NAME = 'ai-dca-cn-5000';

async function cfRequest(endpoint, options = {}) {
  const url = `https://api.cloudflare.com/client/v4${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function main() {
  if (MANUAL_TOKEN && MANUAL_TOKEN.trim()) {
    console.log('[Tunnel Setup] Found manual CLOUDFLARE_TUNNEL_TOKEN in environment.');
    fs.writeFileSync('/tmp/cloudflared_token.txt', MANUAL_TOKEN.trim(), 'utf8');
  }

  if (!API_TOKEN || !ACCOUNT_ID) {
    console.log('[Tunnel Setup] Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID.');
    return;
  }

  console.log(`[Tunnel Setup] Checking Cloudflare Tunnel permissions for account ${ACCOUNT_ID}...`);
  const listRes = await cfRequest(`/accounts/${ACCOUNT_ID}/cfd_tunnel?name=${encodeURIComponent(TUNNEL_NAME)}&is_deleted=false`);

  if (!listRes.ok) {
    console.log(`[Tunnel Setup] API returned status ${listRes.status}:`, JSON.stringify(listRes.data?.errors || listRes.data));
    if (listRes.status === 401 || listRes.status === 403) {
      console.log('[Tunnel Setup] Note: CLOUDFLARE_API_TOKEN does not have Zero Trust / Cloudflare Tunnel permissions.');
    }
    return;
  }

  let tunnel = (listRes.data?.result || []).find(t => t.name === TUNNEL_NAME && !t.deleted_at);
  let tunnelId;
  let tunnelToken = MANUAL_TOKEN ? MANUAL_TOKEN.trim() : null;

  if (tunnel) {
    tunnelId = tunnel.id;
    console.log(`[Tunnel Setup] Found existing tunnel "${TUNNEL_NAME}" (ID: ${tunnelId}).`);
  } else {
    console.log(`[Tunnel Setup] Creating new tunnel "${TUNNEL_NAME}"...`);
    const createRes = await cfRequest(`/accounts/${ACCOUNT_ID}/cfd_tunnel`, {
      method: 'POST',
      body: JSON.stringify({
        name: TUNNEL_NAME,
        config_src: 'cloudflare'
      })
    });

    if (!createRes.ok) {
      console.error('[Tunnel Setup] Failed to create tunnel:', JSON.stringify(createRes.data?.errors || createRes.data));
      return;
    }

    tunnel = createRes.data.result;
    tunnelId = tunnel.id;
    tunnelToken = tunnel.token;
    console.log(`[Tunnel Setup] Successfully created tunnel "${TUNNEL_NAME}" (ID: ${tunnelId}).`);
  }

  if (!tunnelToken) {
    console.log(`[Tunnel Setup] Fetching token for tunnel ${tunnelId}...`);
    const tokenRes = await cfRequest(`/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/token`);
    if (tokenRes.ok && tokenRes.data?.result) {
      tunnelToken = tokenRes.data.result;
    } else {
      console.error('[Tunnel Setup] Could not get tunnel token:', JSON.stringify(tokenRes.data?.errors || tokenRes.data));
      return;
    }
  }

  // Save token for deployment step
  fs.writeFileSync('/tmp/cloudflared_token.txt', tunnelToken.trim(), 'utf8');
  console.log('[Tunnel Setup] Tunnel token written to /tmp/cloudflared_token.txt.');

  // Configure Tunnel Ingress Routing
  console.log(`[Tunnel Setup] Configuring ingress rule for ${DOMAIN} -> https://localhost:5000...`);
  const configRes = await cfRequest(`/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/configurations`, {
    method: 'PUT',
    body: JSON.stringify({
      config: {
        ingress: [
          {
            hostname: DOMAIN,
            service: 'https://localhost:5000',
            originRequest: {
              noTLSVerify: true
            }
          },
          {
            service: 'http_status:404'
          }
        ]
      }
    })
  });

  if (configRes.ok) {
    console.log('[Tunnel Setup] Ingress configuration updated successfully.');
  } else {
    console.warn('[Tunnel Setup] Ingress config update warning:', JSON.stringify(configRes.data?.errors || configRes.data));
  }

  // Update DNS Record in Cloudflare to point to the Tunnel
  console.log(`[Tunnel Setup] Looking up zone for ${ZONE_NAME}...`);
  const zoneRes = await cfRequest(`/zones?name=${ZONE_NAME}`);
  const zoneId = zoneRes.data?.result?.[0]?.id;

  if (zoneId) {
    console.log(`[Tunnel Setup] Zone ID for ${ZONE_NAME}: ${zoneId}. Looking up DNS records for ${DOMAIN}...`);
    const dnsRes = await cfRequest(`/zones/${zoneId}/dns_records?name=${DOMAIN}`);
    const records = dnsRes.data?.result || [];
    const targetContent = `${tunnelId}.cfargotunnel.com`;

    if (records.length > 0) {
      for (const rec of records) {
        if (rec.type === 'CNAME' && rec.content === targetContent && rec.proxied) {
          console.log(`[Tunnel Setup] DNS CNAME already correctly pointing to ${targetContent} with proxy.`);
        } else {
          console.log(`[Tunnel Setup] Updating existing DNS record ${rec.id} (${rec.type} -> CNAME ${targetContent})...`);
          let updateDns = await cfRequest(`/zones/${zoneId}/dns_records/${rec.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              type: 'CNAME',
              name: DOMAIN,
              content: targetContent,
              proxied: true,
              ttl: 1
            })
          });
          if (!updateDns.ok) {
            console.log(`[Tunnel Setup] PUT failed, deleting old record ${rec.id} and recreating...`);
            await cfRequest(`/zones/${zoneId}/dns_records/${rec.id}`, { method: 'DELETE' });
            updateDns = await cfRequest(`/zones/${zoneId}/dns_records`, {
              method: 'POST',
              body: JSON.stringify({
                type: 'CNAME',
                name: DOMAIN,
                content: targetContent,
                proxied: true,
                ttl: 1
              })
            });
          }
          if (updateDns.ok) {
            console.log(`[Tunnel Setup] DNS record updated to CNAME ${targetContent} (proxied: true).`);
          } else {
            console.warn('[Tunnel Setup] DNS update warning:', JSON.stringify(updateDns.data?.errors || updateDns.data));
          }
        }
      }
    } else {
      console.log(`[Tunnel Setup] Creating CNAME record ${DOMAIN} -> ${targetContent}...`);
      const createDns = await cfRequest(`/zones/${zoneId}/dns_records`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'CNAME',
          name: DOMAIN,
          content: targetContent,
          proxied: true,
          ttl: 1
        })
      });
      if (createDns.ok) {
        console.log(`[Tunnel Setup] Created DNS CNAME record ${DOMAIN} -> ${targetContent}.`);
      } else {
        console.warn('[Tunnel Setup] DNS create warning:', JSON.stringify(createDns.data?.errors || createDns.data));
      }
    }
  } else {
    console.warn(`[Tunnel Setup] Could not find zone ID for ${ZONE_NAME}.`);
  }

  console.log('[Tunnel Setup] Cloudflare Tunnel configuration complete!');
}

main().catch(err => {
  console.error('[Tunnel Setup] Error:', err);
});
