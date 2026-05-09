use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
pub struct PtyOutput {
    pub agent_id: String,
    pub data: Vec<u8>,
}

#[derive(Clone, serde::Serialize)]
pub struct PtyExit {
    pub agent_id: String,
    pub code: Option<u32>,
}

struct Agent {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

type AgentMap = Arc<Mutex<HashMap<String, Arc<Agent>>>>;

#[derive(Default)]
pub struct AgentManager {
    agents: AgentMap,
}

impl AgentManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn spawn(
        &self,
        app: AppHandle,
        id: String,
        command: String,
        args: Vec<String>,
        cwd: Option<String>,
        cols: u16,
        rows: u16,
    ) -> Result<String> {
        if self.agents.lock().contains_key(&id) {
            return Err(anyhow!("agent id {id} already in use"));
        }

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new(&command);
        for arg in args {
            cmd.arg(arg);
        }
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }
        for (k, v) in std::env::vars() {
            cmd.env(k, v);
        }

        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| anyhow!("take_writer failed: {e}"))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| anyhow!("try_clone_reader failed: {e}"))?;

        let agent = Arc::new(Agent {
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
        });

        self.agents.lock().insert(id.clone(), agent);

        let app_reader = app.clone();
        let id_reader = id.clone();
        let agents_reader = Arc::clone(&self.agents);
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let _ = app_reader.emit(
                            "pty-output",
                            PtyOutput {
                                agent_id: id_reader.clone(),
                                data: buf[..n].to_vec(),
                            },
                        );
                    }
                    Err(_) => break,
                }
            }

            let code = agents_reader
                .lock()
                .get(&id_reader)
                .and_then(|a| a.child.lock().try_wait().ok().flatten())
                .map(|status| status.exit_code());

            let _ = app_reader.emit(
                "pty-exit",
                PtyExit {
                    agent_id: id_reader.clone(),
                    code,
                },
            );

            agents_reader.lock().remove(&id_reader);
        });

        Ok(id)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<()> {
        let agent = self
            .agents
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow!("agent {id} not found"))?;
        agent.writer.lock().write_all(data)?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let agent = self
            .agents
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow!("agent {id} not found"))?;
        agent.master.lock().resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    pub fn kill(&self, id: &str) -> Result<()> {
        if let Some(agent) = self.agents.lock().remove(id) {
            let _ = agent.child.lock().kill();
        }
        Ok(())
    }
}
