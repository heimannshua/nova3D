#!/usr/bin/env node
const projectRef = process.env.SUPABASE_PROJECT_REF || 'jtxtxdzqltogxijgksyq';
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!accessToken) {
  console.error('SUPABASE_ACCESS_TOKEN is required for Management API restore.');
  process.exit(2);
}

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/restore`, {
  method: 'POST',
  headers: {authorization: `Bearer ${accessToken}`, accept: 'application/json'},
});

const body = await response.text();
console.log(`Supabase restore request for ${projectRef}: HTTP ${response.status}`);
if (body) console.log(body);
if (!response.ok) process.exit(1);
