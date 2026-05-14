// container/skills.js
// 扫描 ./skills/*/skill.json，把每个 skill 注册成一个 OpenAI function-calling tool。
// handler 通过 child_process.spawn 启动 node 子进程，stdin 传 JSON 参数，stdout 收 JSON 结果，超时强杀。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = process.env.SKILLS_DIR || join(__dirname, 'skills');

function safeStat(p) {
	try { return statSync(p); } catch { return null; }
}

function loadSkillManifests() {
	const skills = [];
	const root = safeStat(SKILLS_DIR);
	if (!root || !root.isDirectory()) return skills;
	for (const entry of readdirSync(SKILLS_DIR)) {
		const dir = join(SKILLS_DIR, entry);
		const st = safeStat(dir);
		if (!st || !st.isDirectory()) continue;
		const manifestPath = join(dir, 'skill.json');
		if (!safeStat(manifestPath)) continue;
		let manifest;
		try {
			manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		} catch (err) {
			console.error(`[skills] failed to parse ${manifestPath}: ${err.message}`);
			continue;
		}
		if (!manifest.name || !manifest.description) {
			console.error(`[skills] skip ${entry}: missing name/description in skill.json`);
			continue;
		}
		const entryFile = manifest.entry || 'scripts/main.js';
		const entryPath = join(dir, entryFile);
		if (!safeStat(entryPath)) {
			console.error(`[skills] skip ${manifest.name}: entry ${entryPath} not found`);
			continue;
		}
		skills.push({
			name: manifest.name,
			description: manifest.description,
			parameters: manifest.parameters || { type: 'object' },
			entryPath,
			cwd: dir,
			timeoutMs: Number(manifest.timeout_ms) || 90000,
		});
	}
	return skills;
}

function runSkill(skill, args) {
	return new Promise((resolve) => {
		const proc = spawn(process.execPath, [skill.entryPath], {
			cwd: skill.cwd,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: { ...process.env, SKILL_NAME: skill.name },
		});
		let stdout = '';
		let stderr = '';
		let killed = false;
		const timer = setTimeout(() => {
			killed = true;
			try { proc.kill('SIGKILL'); } catch {}
		}, skill.timeoutMs);
		proc.stdout.on('data', (d) => { stdout += d.toString(); });
		proc.stderr.on('data', (d) => { stderr += d.toString(); });
		proc.on('close', (code) => {
			clearTimeout(timer);
			if (killed) {
				return resolve({ ok: false, error: `skill_timeout_${skill.timeoutMs}ms`, stderr: stderr.slice(-800) });
			}
			if (code !== 0) {
				return resolve({ ok: false, error: `skill_exit_${code}`, stderr: stderr.slice(-1500) });
			}
			try {
				const parsed = JSON.parse(stdout);
				return resolve(parsed);
			} catch (err) {
				return resolve({ ok: false, error: 'skill_invalid_json_output', stdout_tail: stdout.slice(-1200), stderr_tail: stderr.slice(-400) });
			}
		});
		proc.on('error', (err) => {
			clearTimeout(timer);
			resolve({ ok: false, error: `skill_spawn_error_${err.message}` });
		});
		try {
			proc.stdin.write(JSON.stringify(args || {}));
			proc.stdin.end();
		} catch (err) {
			clearTimeout(timer);
			resolve({ ok: false, error: `skill_stdin_error_${err.message}` });
		}
	});
}

const _skills = loadSkillManifests();
console.log(`[skills] loaded ${_skills.length} skill(s): ${_skills.map((s) => s.name).join(', ') || '(none)'}`);

export const SKILL_TOOL_DEFS = _skills.map((s) => ({
	type: 'function',
	function: {
		name: s.name,
		description: s.description,
		parameters: s.parameters,
	},
}));

export const SKILL_TOOL_HANDLERS = Object.fromEntries(
	_skills.map((s) => [s.name, (args) => runSkill(s, args)]),
);
