import React, { useState, useEffect } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function App() {
  const [urls, setUrls] = useState([]);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [checkingIds, setCheckingIds] = useState(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, up, down
  const [feedback, setFeedback] = useState({ type: '', message: '' });

  // Fetch URLs on load and periodically
  const fetchUrls = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/urls`);
      if (!response.ok) {
        throw new Error('Failed to fetch monitored URLs');
      }
      const data = await response.json();
      setUrls(data);
      setFeedback({ type: '', message: '' });
    } catch (err) {
      console.error(err);
      setFeedback({ 
        type: 'error', 
        message: 'Could not connect to the backend server. Please verify the API is running.' 
      });
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchUrls(true);
    // Poll every 10 seconds
    const interval = setInterval(() => {
      fetchUrls(false);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Show temporary feedback messages
  const showFeedback = (type, message) => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback(prev => prev.message === message ? { type: '', message: '' } : prev);
    }, 5000);
  };

  // Add a new URL
  const handleAddUrl = async (e) => {
    e.preventDefault();
    if (!newUrl.trim()) return;

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: newUrl,
          name: newName || null
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to add URL');
      }

      setNewUrl('');
      setNewName('');
      showFeedback('success', `Successfully registered URL: ${data.url}`);
      fetchUrls(false);
    } catch (err) {
      showFeedback('error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Delete a URL
  const handleDeleteUrl = async (id, name) => {
    if (!confirm(`Are you sure you want to stop monitoring ${name}?`)) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/urls/${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error('Failed to delete URL');
      }
      showFeedback('success', `Removed monitor for ${name}`);
      fetchUrls(false);
    } catch (err) {
      showFeedback('error', err.message);
    }
  };

  // Trigger manual check
  const handleCheckNow = async (id) => {
    setCheckingIds(prev => new Set([...prev, id]));
    try {
      const response = await fetch(`${API_BASE_URL}/api/urls/${id}/check`, {
        method: 'POST'
      });
      if (!response.ok) {
        throw new Error('Check failed');
      }
      showFeedback('success', 'Manual health check completed.');
      fetchUrls(false);
    } catch (err) {
      showFeedback('error', `Failed to ping URL: ${err.message}`);
    } finally {
      setCheckingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // Helpers to compute statistics
  const totalMonitored = urls.length;
  const upUrls = urls.filter(u => u.latest_check && u.latest_check.status_code >= 200 && u.latest_check.status_code < 400).length;
  const downUrls = urls.filter(u => !u.latest_check || u.latest_check.status_code === null || u.latest_check.status_code >= 400).length;
  
  const upUrlsWithSpeed = urls.filter(u => u.latest_check && u.latest_check.status_code >= 200 && u.latest_check.status_code < 400 && u.latest_check.response_time_ms);
  const avgResponseTime = upUrlsWithSpeed.length > 0
    ? roundTo(upUrlsWithSpeed.reduce((sum, u) => sum + u.latest_check.response_time_ms, 0) / upUrlsWithSpeed.length, 1)
    : 0;

  function roundTo(num, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  }

  // Filter and search
  const filteredUrls = urls.filter(u => {
    const matchesSearch = u.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          u.url?.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (statusFilter === 'all') return matchesSearch;
    const isUp = u.latest_check && u.latest_check.status_code >= 200 && u.latest_check.status_code < 400;
    if (statusFilter === 'up') return matchesSearch && isUp;
    if (statusFilter === 'down') return matchesSearch && !isUp;
    return matchesSearch;
  });

  const formatLastChecked = (isoString) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="app-container">
      {/* Background Blobs for Modern Aesthetic */}
      <div className="blob blob-1"></div>
      <div className="blob blob-2"></div>

      <header className="app-header">
        <div className="logo-container">
          <div className="app-icon">⚡</div>
          <h1>Uptime<span className="gradient-text">Pulse</span></h1>
        </div>
        <p className="app-subtitle">Real-time status monitoring dashboard for critical web services</p>
      </header>

      {/* Global Metrics Panel */}
      <section className="metrics-panel">
        <div className="metric-card card-glass">
          <h3>Total Monitored</h3>
          <p className="metric-value">{totalMonitored}</p>
          <div className="metric-detail">Configured targets</div>
        </div>
        <div className="metric-card card-glass text-success">
          <h3>Healthy (UP)</h3>
          <p className="metric-value">
            {upUrls}
            <span className="dot dot-green dot-pulse inline-dot"></span>
          </p>
          <div className="metric-detail">Responding normally</div>
        </div>
        <div className={`metric-card card-glass ${downUrls > 0 ? 'text-danger card-error-pulse' : 'text-muted'}`}>
          <h3>Down (DOWN)</h3>
          <p className="metric-value">
            {downUrls}
            {downUrls > 0 && <span className="dot dot-red dot-pulse inline-dot"></span>}
          </p>
          <div className="metric-detail">{downUrls > 0 ? 'Action required immediately' : 'All systems operational'}</div>
        </div>
        <div className="metric-card card-glass text-info">
          <h3>Avg Response</h3>
          <p className="metric-value">{avgResponseTime} <span className="value-unit">ms</span></p>
          <div className="metric-detail">Healthy URLs only</div>
        </div>
      </section>

      {/* Feedback alerts */}
      {feedback.message && (
        <div className={`alert-toast toast-${feedback.type}`}>
          <div className="toast-content">
            <span className="toast-icon">{feedback.type === 'success' ? '✓' : '⚠'}</span>
            <p>{feedback.message}</p>
          </div>
        </div>
      )}

      {/* Add New Monitor Form */}
      <section className="form-section card-glass">
        <h2>Add New Service Target</h2>
        <form onSubmit={handleAddUrl} className="inline-form">
          <div className="input-group">
            <label htmlFor="url-input">Target URL</label>
            <input
              id="url-input"
              type="text"
              placeholder="e.g. google.com or https://api.myproject.com"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              required
            />
          </div>
          <div className="input-group">
            <label htmlFor="name-input">Display Name (Optional)</label>
            <input
              id="name-input"
              type="text"
              placeholder="e.g. Google Search"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Registering...' : 'Add Monitor'}
          </button>
        </form>
      </section>

      {/* Main List Toolbar */}
      <section className="toolbar-section card-glass">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search monitors by name or URL..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="filter-tabs">
          <button
            className={`tab-btn ${statusFilter === 'all' ? 'tab-active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All ({totalMonitored})
          </button>
          <button
            className={`tab-btn ${statusFilter === 'up' ? 'tab-active' : ''}`}
            onClick={() => setStatusFilter('up')}
          >
            UP ({upUrls})
          </button>
          <button
            className={`tab-btn ${statusFilter === 'down' ? 'tab-active' : ''}`}
            onClick={() => setStatusFilter('down')}
          >
            DOWN ({downUrls})
          </button>
        </div>
      </section>

      {/* List of Monitors */}
      <main className="monitors-list">
        {loading ? (
          <div className="loader-container">
            <div className="spinner"></div>
            <p>Loading monitors and checks...</p>
          </div>
        ) : filteredUrls.length === 0 ? (
          <div className="empty-state card-glass">
            <div className="empty-icon">📁</div>
            <h3>No monitors found</h3>
            <p>
              {searchTerm || statusFilter !== 'all' 
                ? 'Try adjusting your search query or filters.' 
                : 'Get started by adding a target URL above to track its status.'}
            </p>
          </div>
        ) : (
          <div className="grid-layout">
            {filteredUrls.map(u => {
              const checking = checkingIds.has(u.id);
              const isUp = u.latest_check && u.latest_check.status_code >= 200 && u.latest_check.status_code < 400;
              const hasChecked = !!u.latest_check;
              
              // CSS status helper classes
              let statusClass = 'status-pending';
              let statusText = 'Pending First Check';
              
              if (hasChecked) {
                statusClass = isUp ? 'status-up' : 'status-down';
                statusText = isUp ? `UP (${u.latest_check.status_code})` : 'DOWN';
              }
              if (checking) {
                statusClass = 'status-checking';
                statusText = 'Checking...';
              }

              return (
                <div key={u.id} className={`monitor-card card-glass border-${statusClass}`}>
                  {/* Card Header */}
                  <div className="card-header">
                    <div>
                      <h3 className="monitor-name">{u.name || 'Unnamed Target'}</h3>
                      <a href={u.url} target="_blank" rel="noopener noreferrer" className="monitor-url">
                        {u.url} ↗
                      </a>
                    </div>
                    
                    <span className={`status-badge ${statusClass}`}>
                      <span className={`dot dot-${isUp ? 'green' : hasChecked ? 'red' : 'gray'} ${checking || !hasChecked ? 'dot-pulse' : ''}`}></span>
                      {statusText}
                    </span>
                  </div>

                  {/* Card Body Metrics */}
                  <div className="card-body">
                    <div className="metric-row">
                      <div className="metric-item">
                        <span className="metric-label">Response Time</span>
                        <span className="metric-value">
                          {checking ? (
                            '...'
                          ) : !hasChecked ? (
                            'N/A'
                          ) : u.latest_check.response_time_ms ? (
                            `${u.latest_check.response_time_ms} ms`
                          ) : (
                            '—'
                          )}
                        </span>
                      </div>
                      <div className="metric-item">
                        <span className="metric-label">Last Checked</span>
                        <span className="metric-value">
                          {checking ? 'Just now' : formatLastChecked(u.latest_check?.timestamp)}
                        </span>
                      </div>
                    </div>

                    {/* Check History / Uptime Sparkline */}
                    <div className="history-section">
                      <span className="history-label">Uptime History (Last 10 checks)</span>
                      <div className="sparkline-container">
                        {u.history && u.history.length > 0 ? (
                          u.history.map((check, idx) => {
                            const checkUp = check.status_code >= 200 && check.status_code < 400;
                            const checkCode = check.status_code;
                            const checkTime = check.response_time_ms;
                            const checkErr = check.error_message;
                            
                            let checkClass = 'bar-gray';
                            let tooltipTitle = 'Pending';
                            
                            if (checkCode !== undefined) {
                              if (checkUp) {
                                checkClass = checkTime > 1000 ? 'bar-yellow' : 'bar-green';
                                tooltipTitle = `${checkCode} - ${checkTime}ms`;
                              } else {
                                checkClass = 'bar-red';
                                tooltipTitle = checkCode ? `Error: ${checkCode}` : `Failed: ${checkErr}`;
                              }
                            }

                            return (
                              <div 
                                key={check.id || idx} 
                                className={`sparkbar ${checkClass}`}
                              >
                                <span className="tooltip-text">
                                  {tooltipTitle}
                                  <br />
                                  <small>{new Date(check.timestamp).toLocaleTimeString()}</small>
                                </span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="sparkline-empty">No check logs recorded yet.</div>
                        )}
                      </div>
                    </div>

                    {/* Display exact error text if down */}
                    {hasChecked && !isUp && u.latest_check.error_message && (
                      <div className="error-log-box">
                        <strong>Error Log:</strong> {u.latest_check.error_message}
                      </div>
                    )}
                  </div>

                  {/* Card Actions Footer */}
                  <div className="card-footer">
                    <button 
                      className="btn-secondary" 
                      onClick={() => handleCheckNow(u.id)}
                      disabled={checking}
                    >
                      {checking ? 'Pinging...' : 'Check Now'}
                    </button>
                    <button 
                      className="btn-danger" 
                      onClick={() => handleDeleteUrl(u.id, u.name)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer className="app-footer-credit">
        <p>UptimePulse MVP Dashboard &bull; Local Docker Environment</p>
      </footer>
    </div>
  );
}

export default App;
