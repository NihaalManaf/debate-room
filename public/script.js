// Startup Debate Room - Frontend Logic

// ============================================
// CONSTANTS
// ============================================
const MAX_FREE_ROUNDS = 3; // Set to 10 for production
const MAX_FREE_FILES = 1;  // Free users can only upload 1 file
const MAX_FILE_SIZE_MB = 10;
const ALLOWED_FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', // Images
  'application/pdf',                                      // PDFs
  'text/plain',                                           // .txt
  'text/rtf', 'application/rtf'                          // .rtf
];

// ============================================
// FILE MANAGER
// ============================================

class FileManager {
  constructor() {
    this.files = []; // Array of { file, type, content, description, status }
    this.init();
  }

  init() {
    this.dropzone = document.getElementById('uploadDropzone');
    this.fileInput = document.getElementById('fileInput');
    this.previewsContainer = document.getElementById('filePreviews');
    this.limitHint = document.getElementById('fileLimitHint');

    if (!this.dropzone) return;

    // Click to upload
    this.dropzone.addEventListener('click', () => this.fileInput.click());

    // File input change
    this.fileInput.addEventListener('change', (e) => {
      this.handleFiles(e.target.files);
      this.fileInput.value = ''; // Reset for same file re-upload
    });

    // Drag and drop
    this.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropzone.classList.add('dragover');
    });

    this.dropzone.addEventListener('dragleave', () => {
      this.dropzone.classList.remove('dragover');
    });

    this.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropzone.classList.remove('dragover');
      this.handleFiles(e.dataTransfer.files);
    });

    this.updateLimitHint();
  }

  getMaxFiles() {
    const auth = window.authManager;
    if (auth && auth.isPremium()) {
      return Infinity; // Unlimited for premium
    }
    return MAX_FREE_FILES;
  }

  canAddMoreFiles() {
    return this.files.length < this.getMaxFiles();
  }

  handleFiles(fileList) {
    const maxFiles = this.getMaxFiles();

    for (const file of fileList) {
      // Check file limit
      if (this.files.length >= maxFiles) {
        this.showToast(`Free users can only upload ${MAX_FREE_FILES} file. Sign in for more!`, 'warning');
        break;
      }

      // Check file type
      if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        this.showToast(`Unsupported file type: ${file.type}`, 'error');
        continue;
      }

      // Check file size
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        this.showToast(`File too large (max ${MAX_FILE_SIZE_MB}MB)`, 'error');
        continue;
      }

      // Determine file type
      let fileType = 'unknown';
      if (file.type.startsWith('image/')) {
        fileType = 'image';
      } else if (file.type === 'application/pdf') {
        fileType = 'pdf';
      } else if (file.type === 'text/plain' || file.type === 'text/rtf' || file.type === 'application/rtf') {
        fileType = 'text';
      }

      // Add file
      const fileData = {
        id: Date.now() + Math.random(),
        file: file,
        type: fileType,
        name: file.name,
        content: null,
        description: null,
        status: 'processing'
      };

      this.files.push(fileData);
      this.renderPreview(fileData);
      this.processFile(fileData);
    }

    this.updateLimitHint();
  }

  renderPreview(fileData) {
    const preview = document.createElement('div');
    preview.className = 'file-preview';
    preview.dataset.id = fileData.id;

    const icons = { image: '🖼️', pdf: '📄', text: '📝' };
    const icon = icons[fileData.type] || '📎';

    preview.innerHTML = `
      <span class="file-preview-icon">${icon}</span>
      <span class="file-preview-name" title="${fileData.name}">${this.truncateName(fileData.name)}</span>
      <span class="file-preview-status processing" data-status>Processing...</span>
      <button class="file-preview-remove" title="Remove" data-remove>×</button>
    `;

    // Remove button handler
    preview.querySelector('[data-remove]').addEventListener('click', () => {
      this.removeFile(fileData.id);
    });

    this.previewsContainer.appendChild(preview);
  }

  truncateName(name) {
    if (name.length > 15) {
      const ext = name.split('.').pop();
      return name.substring(0, 10) + '...' + ext;
    }
    return name;
  }

  async processFile(fileData) {
    try {
      if (fileData.type === 'image') {
        // Convert image to base64
        const base64 = await this.fileToBase64(fileData.file);
        fileData.content = base64;

        // Try to get GPT-4 Vision description
        this.updatePreviewStatus(fileData.id, 'Analyzing...', 'processing');
        const description = await this.analyzeImage(base64);
        fileData.description = description;

        fileData.status = 'ready';
        this.updatePreviewStatus(fileData.id, 'Ready ✓', 'ready');
      } else if (fileData.type === 'pdf') {
        // Extract text from PDF
        const text = await this.extractPdfText(fileData.file);
        fileData.content = text;
        fileData.status = 'ready';
        this.updatePreviewStatus(fileData.id, 'Ready ✓', 'ready');
      } else if (fileData.type === 'text') {
        // Read text file directly
        const text = await this.readTextFile(fileData.file);
        fileData.content = text;
        fileData.status = 'ready';
        this.updatePreviewStatus(fileData.id, 'Ready ✓', 'ready');
      }
    } catch (error) {
      console.error('File processing error:', error);
      fileData.status = 'error';
      this.updatePreviewStatus(fileData.id, 'Error', 'error');
    }
  }

  readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  async analyzeImage(base64Data) {
    // Get API key from the debate arena
    const apiKey = document.getElementById('apiKeyInput')?.value?.trim();
    if (!apiKey) {
      return '[Image attached - enter API key to analyze]';
    }

    try {
      const response = await fetch('/api/analyze-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({
          imageData: base64Data,
          context: document.getElementById('ideaInput')?.value?.trim() || ''
        })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Image analysis failed:', error);
        return '[Image attached]';
      }

      const data = await response.json();
      return data.description || '[Image attached]';
    } catch (error) {
      console.error('Image analysis error:', error);
      return '[Image attached]';
    }
  }

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async extractPdfText(file) {
    // Use pdf.js to extract text
    // For now, we'll use a simple approach - just note that it's a PDF
    // Full pdf.js integration can be added later
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          // Try to load pdf.js if available
          if (window.pdfjsLib) {
            const pdf = await window.pdfjsLib.getDocument({ data: reader.result }).promise;
            let text = '';
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const content = await page.getTextContent();
              text += content.items.map(item => item.str).join(' ') + '\n';
            }
            resolve(text.trim() || '[PDF content could not be extracted]');
          } else {
            // Fallback if pdf.js not loaded
            resolve(`[PDF document: ${file.name}]`);
          }
        } catch (e) {
          console.error('PDF extraction error:', e);
          resolve(`[PDF document: ${file.name}]`);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  updatePreviewStatus(fileId, text, status) {
    const preview = this.previewsContainer.querySelector(`[data-id="${fileId}"]`);
    if (preview) {
      const statusEl = preview.querySelector('[data-status]');
      statusEl.textContent = text;
      statusEl.className = `file-preview-status ${status}`;
    }
  }

  removeFile(fileId) {
    this.files = this.files.filter(f => f.id !== fileId);
    const preview = this.previewsContainer.querySelector(`[data-id="${fileId}"]`);
    if (preview) {
      preview.style.opacity = '0';
      preview.style.transform = 'scale(0.9)';
      setTimeout(() => preview.remove(), 150);
    }
    this.updateLimitHint();
  }

  updateLimitHint() {
    const auth = window.authManager;
    const isPremium = auth && auth.isPremium();
    const isSignedIn = auth && auth.user;

    if (isPremium) {
      this.limitHint.textContent = '';
      this.limitHint.className = 'file-limit-hint';
    } else if (this.files.length >= MAX_FREE_FILES) {
      this.limitHint.textContent = isSignedIn
        ? 'Upgrade to Premium for unlimited files'
        : 'Sign in for more file uploads';
      this.limitHint.className = 'file-limit-hint warning';
    } else {
      this.limitHint.textContent = `${this.files.length}/${MAX_FREE_FILES} file${MAX_FREE_FILES > 1 ? 's' : ''}`;
      this.limitHint.className = 'file-limit-hint';
    }
  }

  getFilesForDebate() {
    // Return processed files ready for the debate
    return this.files
      .filter(f => f.status === 'ready')
      .map(f => ({
        type: f.type,
        name: f.name,
        // Use description for images, content for text/pdf
        content: f.type === 'image' ? f.description : f.content
      }));
  }

  clear() {
    this.files = [];
    this.previewsContainer.innerHTML = '';
    this.updateLimitHint();
  }

  showToast(message, type = 'info') {
    // Use AuthManager's toast if available
    if (window.authManager) {
      window.authManager.showToast(message, type);
    } else {
      alert(message);
    }
  }
}

// ============================================
// AUTH MANAGER (Supabase Email/Password)
// ============================================

class AuthManager {
  constructor() {
    this.supabase = null;
    this.user = null;
    this.profile = null; // User profile with is_premium
    this.session = null;
    this.isSignUp = false;
    this.init();
  }

  async init() {
    // Fetch Supabase config from server
    try {
      const response = await fetch('/api/config');
      const config = await response.json();

      if (config.supabaseUrl && config.supabaseAnonKey) {
        this.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

        // Listen for auth state changes
        this.supabase.auth.onAuthStateChange(async (event, session) => {
          this.session = session;
          this.user = session?.user || null;

          // Fetch user profile when logged in
          if (this.user) {
            await this.fetchProfile();
          } else {
            this.profile = null;
          }

          this.updateUI();
        });

        // Check initial session
        const { data: { session } } = await this.supabase.auth.getSession();
        this.session = session;
        this.user = session?.user || null;

        // Fetch profile if logged in
        if (this.user) {
          await this.fetchProfile();
        }
      } else {
        console.log('Supabase not configured');
      }
    } catch (error) {
      console.error('Failed to initialize Supabase:', error);
    }

    this.updateUI();
    this.setupEventListeners();
  }

  async fetchProfile() {
    if (!this.supabase || !this.user) {
      this.profile = { is_premium: false };
      return;
    }

    // Set a timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Profile fetch timeout')), 5000)
    );

    try {
      const queryPromise = this.supabase
        .from('profiles')
        .select('*')
        .eq('id', this.user.id)
        .maybeSingle();

      const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

      if (error) {
        this.profile = { is_premium: false };
      } else if (!data) {
        // Profile doesn't exist - try to create it
        await this.createProfile();
      } else {
        this.profile = data;
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error.message);
      this.profile = { is_premium: false };
    }
  }

  async createProfile() {
    if (!this.supabase || !this.user) return;

    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .insert({
          id: this.user.id,
          email: this.user.email,
          is_premium: false
        })
        .select()
        .single();

      if (error) {
        console.error('Failed to create profile:', error.message);
        this.profile = { is_premium: false };
      } else {
        this.profile = data;
      }
    } catch (error) {
      console.error('Failed to create profile:', error.message);
      this.profile = { is_premium: false };
    }
  }

  isPremium() {
    return this.profile?.is_premium === true;
  }

  setupEventListeners() {
    document.addEventListener('click', (e) => {
      // Sign In button
      if (e.target.closest('#signInBtn')) {
        e.preventDefault();
        this.handleSignIn();
      }
      // Show Sign Up
      if (e.target.closest('#showSignUp')) {
        e.preventDefault();
        this.isSignUp = true;
        this.updateUI();
      }
      // Show Sign In
      if (e.target.closest('#showSignIn')) {
        e.preventDefault();
        this.isSignUp = false;
        this.updateUI();
      }
      // Sign Up button
      if (e.target.closest('#signUpBtn')) {
        e.preventDefault();
        this.handleSignUp();
      }
      // Logout
      if (e.target.closest('#logoutBtn')) {
        e.preventDefault();
        this.handleLogout();
      }
    });

    // Enter key submits form
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target.id === 'authEmail' || e.target.id === 'authPassword')) {
        e.preventDefault();
        if (this.isSignUp) {
          this.handleSignUp();
        } else {
          this.handleSignIn();
        }
      }
    });
  }

  async handleSignIn() {
    if (!this.supabase) {
      this.showToast('Please configure Supabase first', 'error');
      return;
    }

    const email = document.getElementById('authEmail')?.value?.trim();
    const password = document.getElementById('authPassword')?.value;

    if (!email || !password) {
      this.showToast('Please enter email and password', 'error');
      return;
    }

    const btn = document.getElementById('signInBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Signing in...';
    }

    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      this.showToast('Welcome back!', 'success');
    } catch (error) {
      console.error('Sign in error:', error);
      this.showToast(error.message || 'Sign in failed', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    }
  }

  async handleSignUp() {
    if (!this.supabase) {
      this.showToast('Please configure Supabase first', 'error');
      return;
    }

    const email = document.getElementById('authEmail')?.value?.trim();
    const password = document.getElementById('authPassword')?.value;

    if (!email || !password) {
      this.showToast('Please enter email and password', 'error');
      return;
    }

    if (password.length < 6) {
      this.showToast('Password must be at least 6 characters', 'error');
      return;
    }

    const btn = document.getElementById('signUpBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Creating account...';
    }

    try {
      const { data, error } = await this.supabase.auth.signUp({
        email,
        password
      });

      if (error) throw error;

      if (data.user && !data.session) {
        // Email confirmation required
        this.showToast('Check your email to confirm your account!', 'success');
        this.isSignUp = false;
        this.updateUI();
      } else {
        this.showToast('Account created! Welcome!', 'success');
      }
    } catch (error) {
      console.error('Sign up error:', error);
      this.showToast(error.message || 'Sign up failed', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Create Account';
      }
    }
  }

  async handleLogout() {
    if (!this.supabase) return;

    try {
      const { error } = await this.supabase.auth.signOut();
      if (error) throw error;

      this.user = null;
      this.session = null;
      this.showToast('Logged out successfully', 'success');
      this.updateUI();
    } catch (error) {
      console.error('Logout error:', error);
      this.showToast('Logout failed', 'error');
    }
  }

  updateUI() {
    const authCard = document.getElementById('authCard');
    if (!authCard) return;

    const isConfigured = !!this.supabase;
    const isPremium = this.isPremium();

    if (this.user) {
      // User is logged in - show welcome state
      const email = this.user.email;
      const planClass = isPremium ? 'premium' : 'free';
      const planText = isPremium ? '⭐ Premium' : 'Free Plan';
      const roundInfo = isPremium
        ? 'Unlimited debate rounds'
        : `Limited to ${MAX_FREE_ROUNDS} rounds per debate`;

      authCard.innerHTML = `
        <div class="auth-card-header">
          <span class="emblem">${isPremium ? '⭐' : '👋'}</span>
          <h2>Welcome!</h2>
          <p>${email}</p>
        </div>
        <div class="auth-form">
          <div class="user-status">
            <div class="status-badge ${planClass}">${planText}</div>
            <p class="plan-info">${roundInfo}</p>
          </div>
          <button id="myDebatesBtn" class="btn-primary">
            📚 My Debates
          </button>
          ${!isPremium ? `
            <button id="upgradeBtn" class="btn-secondary">
              Upgrade to Premium
            </button>
          ` : ''}
          <button id="logoutBtn" class="btn-secondary">
            Sign Out
          </button>
        </div>
      `;

      // My Debates button handler
      const myDebatesBtn = document.getElementById('myDebatesBtn');
      if (myDebatesBtn) {
        myDebatesBtn.addEventListener('click', () => {
          this.showMyDebates();
        });
      }

      // Upgrade button handler
      const upgradeBtn = document.getElementById('upgradeBtn');
      if (upgradeBtn) {
        upgradeBtn.addEventListener('click', () => {
          this.showToast('Premium upgrade coming soon!', 'info');
        });
      }
    } else if (this.isSignUp) {
      // Show sign up form
      authCard.innerHTML = `
        <div class="auth-card-header">
          <span class="emblem">✦</span>
          <h2>Create Account</h2>
          <p>Join to save debates & more</p>
        </div>
        <div class="auth-form">
          <div class="auth-input-group">
            <label for="authEmail">Email</label>
            <input 
              type="email" 
              id="authEmail" 
              placeholder="you@example.com"
              autocomplete="email"
              ${!isConfigured ? 'disabled' : ''}
            />
          </div>
          <div class="auth-input-group">
            <label for="authPassword">Password</label>
            <input 
              type="password" 
              id="authPassword" 
              placeholder="At least 6 characters"
              autocomplete="new-password"
              ${!isConfigured ? 'disabled' : ''}
            />
          </div>
          <button id="signUpBtn" class="btn-primary" ${!isConfigured ? 'disabled' : ''}>
            Create Account
          </button>
          <p class="auth-switch">
            Already have an account? <a href="#" id="showSignIn">Sign in</a>
          </p>
          ${!isConfigured ? '<p class="auth-hint">Configure Supabase to enable auth</p>' : ''}
        </div>
      `;
    } else {
      // Show sign in form
      authCard.innerHTML = `
        <div class="auth-card-header">
          <span class="emblem">✦</span>
          <h2>Sign In</h2>
          <p>Save debates & unlock premium features</p>
        </div>
        <div class="auth-form">
          <div class="auth-input-group">
            <label for="authEmail">Email</label>
            <input 
              type="email" 
              id="authEmail" 
              placeholder="you@example.com"
              autocomplete="email"
              ${!isConfigured ? 'disabled' : ''}
            />
          </div>
          <div class="auth-input-group">
            <label for="authPassword">Password</label>
            <input 
              type="password" 
              id="authPassword" 
              placeholder="••••••••"
              autocomplete="current-password"
              ${!isConfigured ? 'disabled' : ''}
            />
          </div>
          <button id="signInBtn" class="btn-primary" ${!isConfigured ? 'disabled' : ''}>
            Sign In
          </button>
          <p class="auth-switch">
            Don't have an account? <a href="#" id="showSignUp">Create one</a>
          </p>
          ${!isConfigured ? '<p class="auth-hint">Configure Supabase to enable auth</p>' : ''}
        </div>
      `;
    }
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('active');
    });

    setTimeout(() => {
      toast.classList.remove('active');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  isAuthenticated() {
    return !!this.user;
  }

  getUser() {
    return this.user;
  }

  async showMyDebates() {
    if (!this.supabase || !this.user) return;

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'debates-modal-backdrop';
    modal.innerHTML = `
      <div class="debates-modal">
        <div class="debates-modal-header">
          <h2>📚 My Debates</h2>
          <button class="modal-close-btn" id="closeDebatesModal">×</button>
        </div>
        <div class="debates-list" id="debatesList">
          <div class="debates-loading">Loading debates...</div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Animate in
    requestAnimationFrame(() => {
      modal.classList.add('visible');
    });

    // Close handlers
    const closeBtn = document.getElementById('closeDebatesModal');
    closeBtn.addEventListener('click', () => this.closeDebatesModal(modal));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeDebatesModal(modal);
    });

    // Fetch debates
    try {
      const { data: debates, error } = await this.supabase
        .from('debates')
        .select('*')
        .eq('user_id', this.user.id)
        .order('created_at', { ascending: false });

      const debatesList = document.getElementById('debatesList');

      if (error) {
        debatesList.innerHTML = `<div class="debates-error">Failed to load debates</div>`;
        return;
      }

      if (!debates || debates.length === 0) {
        debatesList.innerHTML = `
          <div class="debates-empty">
            <span class="empty-icon">💭</span>
            <p>No debates yet!</p>
            <p class="empty-hint">Start a debate and it will appear here.</p>
          </div>
        `;
        return;
      }

      debatesList.innerHTML = debates.map(debate => {
        const date = new Date(debate.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
        const winnerBadge = debate.winner
          ? `<span class="winner-badge ${debate.winner}">${debate.winner === 'advocate' ? '✓ Advocate' : debate.winner === 'skeptic' ? '✗ Skeptic' : '⚖ Draw'}</span>`
          : '<span class="winner-badge pending">In Progress</span>';

        return `
          <div class="debate-item" data-debate-id="${debate.id}">
            <div class="debate-item-header">
              <span class="debate-date">${date}</span>
              ${winnerBadge}
            </div>
            <p class="debate-idea">${this.escapeHtml(debate.idea)}</p>
            <div class="debate-item-footer">
              <span class="debate-rounds">${debate.rounds || 0} rounds</span>
              <div class="debate-actions">
                <button class="btn-delete-debate" data-id="${debate.id}" title="Delete debate">🗑</button>
                <button class="btn-view-debate" data-id="${debate.id}">View →</button>
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Add click handlers to view buttons
      debatesList.querySelectorAll('.btn-view-debate').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const debateId = e.target.dataset.id;
          const debate = debates.find(d => d.id === debateId);
          if (debate) {
            this.closeDebatesModal(modal);
            window.debateArena.loadPastDebate(debate);
          }
        });
      });

      // Add click handlers to delete buttons
      debatesList.querySelectorAll('.btn-delete-debate').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const debateId = e.target.dataset.id;

          if (!confirm('Are you sure you want to delete this debate?')) {
            return;
          }

          try {
            const { error } = await this.supabase
              .from('debates')
              .delete()
              .eq('id', debateId);

            if (error) {
              this.showToast('Failed to delete debate', 'error');
              return;
            }

            // Remove from UI
            const item = debatesList.querySelector(`[data-debate-id="${debateId}"]`);
            if (item) {
              item.style.opacity = '0';
              item.style.transform = 'translateX(-20px)';
              setTimeout(() => item.remove(), 200);
            }

            this.showToast('Debate deleted', 'success');

            // Check if list is now empty
            setTimeout(() => {
              if (debatesList.querySelectorAll('.debate-item').length === 0) {
                debatesList.innerHTML = `
                  <div class="debates-empty">
                    <span class="empty-icon">💭</span>
                    <p>No debates yet!</p>
                    <p class="empty-hint">Start a debate and it will appear here.</p>
                  </div>
                `;
              }
            }, 250);

          } catch (error) {
            console.error('Failed to delete debate:', error);
            this.showToast('Failed to delete debate', 'error');
          }
        });
      });

    } catch (error) {
      console.error('Failed to fetch debates:', error);
      document.getElementById('debatesList').innerHTML = `
        <div class="debates-error">Failed to load debates</div>
      `;
    }
  }

  closeDebatesModal(modal) {
    modal.classList.remove('visible');
    setTimeout(() => modal.remove(), 300);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ============================================
// DEBATE ARENA
// ============================================

class DebateArena {
  constructor() {
    this.debateId = null;
    this.currentRound = 0;
    this.isDebating = false;
    this.isPaused = false;
    this.lastAdvocateArgument = '';
    this.lastSkepticArgument = '';

    // Store all arguments for the judge
    this.advocateArguments = [];
    this.skepticArguments = [];

    // Store clarifications from user
    this.clarifications = [];

    // Pending clarification state
    this.pendingClarification = null;

    // Pre-debate clarification state
    this.isPreDebateClarification = false;
    this.preDebateClarifications = [];
    this.pendingPreDebateQuestions = [];
    this.preDebateIdea = null;
    this.preDebateFiles = null;

    this.init();
  }

  init() {
    // DOM Elements
    this.ideaSection = document.getElementById('ideaSection');
    this.debateLayout = document.getElementById('debateLayout');
    this.ideaInput = document.getElementById('ideaInput');
    this.apiKeyInput = document.getElementById('apiKeyInput');
    this.toggleApiKeyBtn = document.getElementById('toggleApiKey');
    this.startDebateBtn = document.getElementById('startDebate');
    this.newDebateBtn = document.getElementById('newDebate');
    this.pauseDebateBtn = document.getElementById('pauseDebate');
    this.judgeDebateBtn = document.getElementById('judgeDebate');
    this.currentIdeaEl = document.getElementById('currentIdea');
    this.roundNumberEl = document.getElementById('roundNumber');
    this.debateChat = document.getElementById('debateChat');

    // Thinking sidebar elements
    this.thinkingEmpty = document.getElementById('thinkingEmpty');
    this.thinkingActive = document.getElementById('thinkingActive');
    this.thinkingWho = document.getElementById('thinkingWho');
    this.thinkingContent = document.getElementById('thinkingContent');

    // Verdict panel elements
    this.verdictPanel = document.getElementById('verdictPanel');
    this.verdictContent = document.getElementById('verdictContent');
    this.closeVerdictBtn = document.getElementById('closeVerdict');

    // Clarification modal elements
    this.clarificationModal = document.getElementById('clarificationModal');
    this.clarificationClaim = document.getElementById('clarificationClaim');
    this.clarificationQuestion = document.getElementById('clarificationQuestion');
    this.clarificationAnswer = document.getElementById('clarificationAnswer');
    this.submitClarificationBtn = document.getElementById('submitClarification');
    this.skipClarificationBtn = document.getElementById('skipClarification');

    // Event Listeners
    this.startDebateBtn.addEventListener('click', () => this.startDebate());

    // Clarification modal handlers
    if (this.submitClarificationBtn) {
      this.submitClarificationBtn.addEventListener('click', () => this.submitClarification());
    }
    if (this.skipClarificationBtn) {
      this.skipClarificationBtn.addEventListener('click', () => this.skipClarification());
    }
    this.newDebateBtn.addEventListener('click', () => this.resetDebate());
    this.pauseDebateBtn.addEventListener('click', () => this.togglePause());
    this.judgeDebateBtn.addEventListener('click', () => this.callJudge());
    this.closeVerdictBtn.addEventListener('click', () => this.closeVerdict());

    // API Key toggle visibility
    this.toggleApiKeyBtn.addEventListener('click', () => {
      if (this.apiKeyInput.type === 'password') {
        this.apiKeyInput.type = 'text';
        this.toggleApiKeyBtn.textContent = '🔒';
      } else {
        this.apiKeyInput.type = 'password';
        this.toggleApiKeyBtn.textContent = '👁';
      }
    });

    // Save API key to localStorage when changed
    this.apiKeyInput.addEventListener('change', () => {
      if (this.apiKeyInput.value) {
        localStorage.setItem('openai_api_key', this.apiKeyInput.value);
      }
    });

    // Load API key from localStorage
    const savedKey = localStorage.getItem('openai_api_key');
    if (savedKey) {
      this.apiKeyInput.value = savedKey;
    }

    // Allow Enter to start debate
    this.ideaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.startDebate();
      }
    });
  }

  async checkHealth() {
    try {
      const response = await fetch('/api/health');
      const data = await response.json();
      if (!data.hasApiKey) {
        this.showError('OpenAI API key not configured. Please add OPENAI_API_KEY to your .env file.');
      }
    } catch (error) {
      console.error('Health check failed:', error);
    }
  }

  getApiKey() {
    return this.apiKeyInput.value.trim();
  }

  async startDebate() {
    const idea = this.ideaInput.value.trim();
    if (!idea) {
      this.ideaInput.focus();
      return;
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.showError('Please enter your OpenAI API key');
      this.apiKeyInput.focus();
      return;
    }

    if (!apiKey.startsWith('sk-')) {
      this.showError('Invalid API key format. It should start with "sk-"');
      this.apiKeyInput.focus();
      return;
    }

    // Get attached files
    const files = window.fileManager ? window.fileManager.getFilesForDebate() : [];
    this.attachedFiles = files;

    // Disable start button while analyzing
    this.startDebateBtn.disabled = true;
    this.startDebateBtn.textContent = 'Analyzing...';

    try {
      // First, analyze the idea and ask clarifying questions BEFORE making assumptions
      const analysisResponse = await fetch('/api/analyze-idea', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({ idea, files })
      });

      if (analysisResponse.ok) {
        const analysis = await analysisResponse.json();

        // If there are clarifying questions, ask them first
        if (analysis.questions && analysis.questions.length > 0) {
          this.startDebateBtn.disabled = false;
          this.startDebateBtn.textContent = 'Start';

          // Store pending questions and continue after all are answered
          await this.askPreDebateClarifications(idea, files, analysis.questions);
          return; // The continuation happens in askPreDebateClarifications
        }
      }

      // No questions needed, proceed directly
      await this.proceedWithDebate(idea, files);

    } catch (error) {
      console.error('Failed to start debate:', error);
      this.showError('Failed to start debate. Please try again.');
      this.startDebateBtn.disabled = false;
      this.startDebateBtn.textContent = 'Start';
    }
  }

  async askPreDebateClarifications(idea, files, questions) {
    // Show questions one at a time using the clarification modal
    this.preDebateClarifications = [];
    this.pendingPreDebateQuestions = [...questions];
    this.preDebateIdea = idea;
    this.preDebateFiles = files;

    // Show first question
    this.showNextPreDebateQuestion();
  }

  showNextPreDebateQuestion() {
    if (this.pendingPreDebateQuestions.length === 0) {
      // All questions answered, proceed with debate
      this.clarificationModal.classList.add('hidden');
      this.isPreDebateClarification = false; // Reset flag
      this.proceedWithDebate(this.preDebateIdea, this.preDebateFiles);
      return;
    }

    const nextQuestion = this.pendingPreDebateQuestions[0];
    this.clarificationClaim.textContent = `"${nextQuestion.claim}"`;
    this.clarificationQuestion.textContent = nextQuestion.question;
    this.clarificationAnswer.value = '';
    this.clarificationModal.classList.remove('hidden');
    this.clarificationAnswer.focus();

    // Mark that we're in pre-debate mode
    this.isPreDebateClarification = true;
  }

  async proceedWithDebate(idea, files) {
    const apiKey = this.getApiKey();

    this.startDebateBtn.disabled = true;
    this.startDebateBtn.textContent = 'Starting...';

    try {
      const response = await fetch('/api/start-debate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({ idea, files })
      });

      const data = await response.json();
      this.debateId = data.debateId;
      this.currentRound = 1;
      this.isPaused = false;
      this.currentIdea = idea;

      // Reset argument storage
      this.advocateArguments = [];
      this.skepticArguments = [];

      // Add pre-debate clarifications to the main clarifications array
      if (this.preDebateClarifications && this.preDebateClarifications.length > 0) {
        this.clarifications = [...this.preDebateClarifications];
      }

      // Clear file manager after starting debate
      if (window.fileManager) {
        window.fileManager.clear();
      }

      // Create debate record in Supabase (for logged-in users)
      await this.createSupabaseDebate(idea);

      // Update UI
      this.currentIdeaEl.textContent = idea;
      this.ideaSection.classList.add('hidden');
      this.debateLayout.classList.remove('hidden');
      this.roundNumberEl.textContent = this.currentRound;
      this.pauseDebateBtn.classList.remove('paused');
      this.pauseDebateBtn.textContent = '⏸';
      this.judgeDebateBtn.disabled = true;

      // Clear previous messages and verdict
      this.debateChat.innerHTML = '';
      this.verdictPanel.classList.add('hidden');
      this.resetThinkingSidebar();

      // Reset button state
      this.startDebateBtn.disabled = false;
      this.startDebateBtn.textContent = 'Start';

      // Start the continuous debate loop
      this.runDebateLoop();

    } catch (error) {
      console.error('Failed to start debate:', error);
      this.showError('Failed to start debate. Please try again.');
      this.startDebateBtn.disabled = false;
      this.startDebateBtn.textContent = 'Start';
    }
  }

  async runDebateLoop() {
    while (!this.isPaused && this.debateId) {
      // Check round limit for free/unauthenticated users
      if (this.currentRound > MAX_FREE_ROUNDS && !this.canAccessUnlimitedRounds()) {
        this.isPaused = true;
        this.showRoundLimitReached();
        break;
      }

      await this.runDebateRound();

      // Enable judge button after first round
      if (this.advocateArguments.length > 0 && this.skepticArguments.length > 0) {
        this.judgeDebateBtn.disabled = false;
      }

      // Save debate progress to Supabase
      await this.updateSupabaseDebate();

      if (this.isPaused) break;

      // Longer pause between rounds to avoid rate limiting
      await this.delay(2500);

      this.currentRound++;
      this.roundNumberEl.textContent = this.currentRound;

      // Check if next round would exceed limit
      if (this.currentRound > MAX_FREE_ROUNDS && !this.canAccessUnlimitedRounds()) {
        this.isPaused = true;
        this.showRoundLimitReached();
        break;
      }
    }
  }

  canAccessUnlimitedRounds() {
    // Check if user is authenticated and has premium
    const auth = window.authManager;
    if (!auth || !auth.user) return false;

    // Check premium status from profile
    return auth.isPremium();
  }

  // ==========================================
  // SUPABASE DEBATE TRACKING
  // ==========================================

  async createSupabaseDebate(idea) {
    const auth = window.authManager;
    if (!auth || !auth.user || !auth.supabase) {
      this.supabaseDebateId = null;
      return;
    }

    try {
      const { data, error } = await auth.supabase
        .from('debates')
        .insert({
          user_id: auth.user.id,
          idea: idea,
          rounds: 0,
          advocate_arguments: [],
          skeptic_arguments: []
        })
        .select()
        .single();

      if (error) {
        console.error('Failed to create debate record:', error);
        this.supabaseDebateId = null;
      } else {
        this.supabaseDebateId = data.id;
        console.log('Debate record created:', this.supabaseDebateId);
      }
    } catch (error) {
      console.error('Failed to create debate record:', error);
      this.supabaseDebateId = null;
    }
  }

  async updateSupabaseDebate() {
    const auth = window.authManager;
    if (!auth || !auth.supabase || !this.supabaseDebateId) return;

    try {
      const { error } = await auth.supabase
        .from('debates')
        .update({
          rounds: this.currentRound,
          advocate_arguments: this.advocateArguments,
          skeptic_arguments: this.skepticArguments
        })
        .eq('id', this.supabaseDebateId);

      if (error) {
        console.error('Failed to update debate:', error);
      }
    } catch (error) {
      console.error('Failed to update debate:', error);
    }
  }

  async saveDebateVerdict(verdict, winner) {
    const auth = window.authManager;
    if (!auth || !auth.supabase || !this.supabaseDebateId) return;

    try {
      const { error } = await auth.supabase
        .from('debates')
        .update({
          verdict: verdict,
          winner: winner,
          rounds: this.currentRound,
          advocate_arguments: this.advocateArguments,
          skeptic_arguments: this.skepticArguments
        })
        .eq('id', this.supabaseDebateId);

      if (error) {
        console.error('Failed to save verdict:', error);
      } else {
        console.log('Debate verdict saved');
      }
    } catch (error) {
      console.error('Failed to save verdict:', error);
    }
  }

  showRoundLimitReached() {
    // Update pause button to show paused state
    this.pauseDebateBtn.classList.add('paused');
    this.pauseDebateBtn.textContent = '▶';

    const auth = window.authManager;
    const isSignedIn = auth && auth.user;
    const isPremium = auth && auth.isPremium();

    // Show limit message
    const limitMessage = document.createElement('div');
    limitMessage.className = 'round-limit-message';

    if (!isSignedIn) {
      // Not signed in
      limitMessage.innerHTML = `
        <div class="limit-content">
          <span class="limit-icon">🔒</span>
          <h3>Round Limit Reached</h3>
          <p>Free users are limited to ${MAX_FREE_ROUNDS} rounds per debate.</p>
          <p>Sign in or upgrade to Premium for unlimited rounds!</p>
          <button class="btn-limit-action" onclick="document.getElementById('authCard').scrollIntoView({behavior: 'smooth'})">
            Sign In to Continue
          </button>
        </div>
      `;
    } else if (!isPremium) {
      // Signed in but free plan
      limitMessage.innerHTML = `
        <div class="limit-content">
          <span class="limit-icon">🔒</span>
          <h3>Round Limit Reached</h3>
          <p>Free plan is limited to ${MAX_FREE_ROUNDS} rounds per debate.</p>
          <p>Upgrade to Premium for unlimited debate rounds!</p>
          <button class="btn-limit-action" onclick="window.authManager.showToast('Premium upgrade coming soon!', 'info')">
            Upgrade to Premium
          </button>
        </div>
      `;
    }

    this.debateChat.appendChild(limitMessage);
    limitMessage.scrollIntoView({ behavior: 'smooth' });
  }

  async runDebateRound() {
    if (this.isDebating) return;
    this.isDebating = true;

    try {
      if (this.isPaused) return;
      await this.getDebaterResponse('advocate', this.lastSkepticArgument);

      // 2 second pause between debaters to avoid rate limiting
      await this.delay(2000);

      if (this.isPaused) return;
      await this.getDebaterResponse('skeptic', this.lastAdvocateArgument);

    } catch (error) {
      console.error('Debate round failed:', error);
    } finally {
      this.isDebating = false;
    }
  }

  async getDebaterResponse(role, previousArgument) {
    const isAdvocate = role === 'advocate';
    const name = isAdvocate ? 'Advocate' : 'Skeptic';
    const icon = isAdvocate ? '✓' : '✗';

    // Show typing indicator in chat
    const typingEl = this.createTypingIndicator(role, name);
    this.debateChat.appendChild(typingEl);
    this.scrollToBottom(this.debateChat);

    // Show thinking in sidebar
    this.showThinking(role, name);

    // Create message element
    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;
    messageEl.innerHTML = `
      <div class="message-header">
        <div class="message-icon">${icon}</div>
        <span class="message-name">${name}</span>
        <span class="message-round">Round ${this.currentRound}</span>
      </div>
      <div class="message-content"></div>
    `;

    try {
      const response = await fetch('/api/debate-turn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.getApiKey()
        },
        body: JSON.stringify({
          debateId: this.debateId,
          role,
          previousArgument,
          clarifications: this.clarifications
        })
      });

      typingEl.remove();
      this.debateChat.appendChild(messageEl);

      const messageContent = messageEl.querySelector('.message-content');
      let fullText = '';
      let thinkingText = '';
      let outputText = '';

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.error) {
                throw new Error(data.error);
              }

              if (data.content) {
                fullText += data.content;

                const parsed = this.parseResponse(fullText);

                // Update thinking sidebar
                if (parsed.thinking !== thinkingText) {
                  thinkingText = parsed.thinking;
                  this.thinkingContent.innerHTML = this.formatText(thinkingText);
                }

                // Update message content
                if (parsed.output !== outputText) {
                  outputText = parsed.output;
                  messageContent.innerHTML = this.formatText(outputText);
                  this.scrollToBottom(this.debateChat);
                }
              }

              if (data.done) {
                // Check if we got an actual response
                if (!outputText || outputText.trim().length < 10) {
                  console.warn(`${role} returned empty or very short response`);
                  console.warn(`Full text received (${fullText.length} chars):`, fullText.substring(0, 500));
                  console.warn(`Parsed thinking (${thinkingText.length} chars):`, thinkingText.substring(0, 200));
                  console.warn(`Parsed output (${outputText.length} chars):`, outputText);

                  // Try to show whatever we got
                  if (fullText.length > 20) {
                    // Use raw text as fallback
                    const cleanText = fullText.replace(/<\/?thinking>/g, '').replace(/<\/?output>/g, '').trim();
                    messageContent.innerHTML = this.formatText(cleanText);
                    outputText = cleanText; // So it gets stored

                    // Still store it for the judge
                    if (role === 'advocate') {
                      this.lastAdvocateArgument = outputText;
                      this.advocateArguments.push(outputText);
                    } else {
                      this.lastSkepticArgument = outputText;
                      this.skepticArguments.push(outputText);
                    }
                  } else {
                    messageContent.innerHTML = `<p style="color: #c4553a; font-style: italic;">${name} had nothing to say... (API returned empty response)</p>`;
                  }
                } else {
                  // Store arguments for the judge
                  if (role === 'advocate') {
                    this.lastAdvocateArgument = outputText;
                    this.advocateArguments.push(outputText);
                  } else {
                    this.lastSkepticArgument = outputText;
                    this.skepticArguments.push(outputText);
                  }
                }

                // Clear thinking after a moment
                setTimeout(() => {
                  if (!this.isDebating) {
                    this.resetThinkingSidebar();
                  }
                }, 500);
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', e);
            }
          }
        }
      }

      // Final check - if no output was captured at all
      if (!outputText || outputText.trim().length < 10) {
        messageContent.innerHTML = `<p style="color: #c4553a; font-style: italic;">${name} didn't respond. Retrying might help.</p>`;
      }
      // Note: In-debate fact-checking disabled since we now ask clarifying questions
      // BEFORE the debate starts (pre-debate clarification flow)

    } catch (error) {
      typingEl.remove();
      console.error(`${role} response failed:`, error);
      this.resetThinkingSidebar();

      // Show error in chat but don't crash the debate
      const errorEl = document.createElement('div');
      errorEl.className = `message ${role}`;
      errorEl.innerHTML = `
        <div class="message-header">
          <div class="message-icon" style="background: #c4553a;">!</div>
          <span class="message-name">${name}</span>
          <span class="message-round">Error</span>
        </div>
        <div class="message-content" style="color: #c4553a;">
          <p>Failed to get response: ${error.message}</p>
          <p style="font-size: 0.8rem; opacity: 0.7;">The debate will continue...</p>
        </div>
      `;
      this.debateChat.appendChild(errorEl);
    }
  }

  async callJudge() {
    if (this.advocateArguments.length === 0 || this.skepticArguments.length === 0) {
      this.showError('Need at least one round of debate before calling the judge.');
      return;
    }

    // Pause the debate
    this.isPaused = true;
    this.pauseDebateBtn.classList.add('paused');
    this.pauseDebateBtn.textContent = '▶';
    this.judgeDebateBtn.disabled = true;

    // Show verdict panel with loading state
    this.verdictPanel.classList.remove('hidden');
    this.verdictContent.innerHTML = '<p style="color: #8b7328; font-style: italic;">⚖️ The judge is deliberating...</p>';

    // Show thinking in sidebar
    this.showThinking('judge', 'Judge');

    try {
      const response = await fetch('/api/judge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.getApiKey()
        },
        body: JSON.stringify({
          debateId: this.debateId,
          advocateArguments: this.advocateArguments,
          skepticArguments: this.skepticArguments,
          idea: this.currentIdea // Fallback for loaded past debates
        })
      });

      let fullText = '';
      let thinkingText = '';
      let outputText = '';

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.error) {
                throw new Error(data.error);
              }

              if (data.content) {
                fullText += data.content;

                const parsed = this.parseResponse(fullText);

                // Update thinking sidebar
                if (parsed.thinking !== thinkingText) {
                  thinkingText = parsed.thinking;
                  this.thinkingContent.innerHTML = this.formatText(thinkingText);
                }

                // Update verdict content
                if (parsed.output !== outputText) {
                  outputText = parsed.output;
                  this.verdictContent.innerHTML = this.formatVerdict(outputText);
                }
              }

              if (data.done) {
                this.resetThinkingSidebar();

                // Extract winner from verdict and save
                const winner = this.extractWinner(outputText);
                await this.saveDebateVerdict(outputText, winner);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

    } catch (error) {
      console.error('Judge failed:', error);
      this.verdictContent.innerHTML = `<p style="color: #c4553a;">Failed to get verdict: ${error.message}</p>`;
      this.resetThinkingSidebar();
    }

    this.judgeDebateBtn.disabled = false;
  }

  extractWinner(verdictText) {
    // Try to extract the winner from the verdict text
    const text = verdictText.toLowerCase();
    if (text.includes('advocate wins') || text.includes('winner: advocate') || text.includes('advocate is the winner')) {
      return 'advocate';
    } else if (text.includes('skeptic wins') || text.includes('winner: skeptic') || text.includes('skeptic is the winner')) {
      return 'skeptic';
    } else if (text.includes('draw') || text.includes('tie')) {
      return 'draw';
    }
    return null;
  }

  formatVerdict(text) {
    if (!text) return '';

    // Convert markdown-style formatting
    let html = text
      // Headers
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Winner highlighting
      .replace(/Winner: (Advocate)/gi, 'Winner: <span class="verdict-winner advocate">$1</span>')
      .replace(/Winner: (Skeptic)/gi, 'Winner: <span class="verdict-winner skeptic">$1</span>')
      // Line breaks to paragraphs
      .split('\n\n')
      .filter(p => p.trim())
      .map(p => {
        if (p.startsWith('<h2>') || p.startsWith('<h3>')) return p;
        if (p.startsWith('- ') || p.startsWith('* ')) {
          const items = p.split('\n').map(li => `<li>${li.replace(/^[-*] /, '')}</li>`).join('');
          return `<ul>${items}</ul>`;
        }
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
      })
      .join('');

    return html;
  }

  closeVerdict() {
    this.verdictPanel.classList.add('hidden');
  }

  showThinking(role, name) {
    this.thinkingEmpty.classList.add('hidden');
    this.thinkingActive.classList.remove('hidden');
    this.thinkingWho.textContent = `${name} is reasoning...`;
    this.thinkingWho.className = `thinking-who ${role}`;
    this.thinkingContent.innerHTML = '';
  }

  resetThinkingSidebar() {
    this.thinkingEmpty.classList.remove('hidden');
    this.thinkingActive.classList.add('hidden');
    this.thinkingContent.innerHTML = '';
  }

  parseResponse(text) {
    let thinking = '';
    let output = '';

    // Try to extract <thinking> tags
    const thinkingMatch = text.match(/<thinking>([\s\S]*?)(<\/thinking>|$)/);
    if (thinkingMatch) {
      thinking = thinkingMatch[1].trim();
    }

    // Try to extract <output> tags
    const outputMatch = text.match(/<output>([\s\S]*?)(<\/output>|$)/);
    if (outputMatch) {
      output = outputMatch[1].trim();
    }

    // FALLBACK: If no <output> tags found, try to get content after </thinking>
    if (!output && text.includes('</thinking>')) {
      const afterThinking = text.split('</thinking>')[1];
      if (afterThinking) {
        // Remove any remaining tags and clean up
        output = afterThinking
          .replace(/<\/?output>/g, '')
          .replace(/<\/?thinking>/g, '')
          .trim();
      }
    }

    // FALLBACK 2: If still no output and no tags at all, just use the text
    if (!output && !text.includes('<thinking>') && !text.includes('<output>')) {
      output = text.trim();
      console.warn('No tags found in response, using raw text');
    }

    // FALLBACK 3: If we have thinking but no output, something went wrong - log it
    if (!output && thinking) {
      console.warn('Got thinking but no output. Full text:', text.substring(0, 500));
    }

    return { thinking, output };
  }

  formatText(text) {
    if (!text) return '';

    const paragraphs = text.split('\n\n').filter(p => p.trim());
    if (paragraphs.length > 1) {
      return paragraphs.map(p => `<p>${this.escapeHtml(p.trim())}</p>`).join('');
    }

    return `<p>${this.escapeHtml(text)}</p>`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  createTypingIndicator(role, name) {
    const el = document.createElement('div');
    el.className = `typing-indicator ${role}`;
    el.innerHTML = `
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
      <span class="typing-label">${name} is preparing...</span>
    `;
    return el;
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.pauseDebateBtn.classList.toggle('paused', this.isPaused);

    if (this.isPaused) {
      this.pauseDebateBtn.textContent = '▶';
      this.pauseDebateBtn.title = 'Resume';
    } else {
      this.pauseDebateBtn.textContent = '⏸';
      this.pauseDebateBtn.title = 'Pause';

      // Close verdict if open
      this.verdictPanel.classList.add('hidden');

      if (!this.isDebating) {
        this.runDebateLoop();
      }
    }
  }

  resetDebate() {
    this.isPaused = true;
    this.debateId = null;
    this.currentRound = 0;
    this.lastAdvocateArgument = '';
    this.lastSkepticArgument = '';
    this.advocateArguments = [];
    this.skepticArguments = [];
    this.ideaInput.value = '';

    this.resetThinkingSidebar();
    this.verdictPanel.classList.add('hidden');
    this.debateLayout.classList.add('hidden');
    this.ideaSection.classList.remove('hidden');
    this.ideaInput.focus();
  }

  async loadPastDebate(debate) {
    // Load a saved debate from Supabase
    this.isPaused = true;
    this.supabaseDebateId = debate.id;
    this.currentIdea = debate.idea;
    this.advocateArguments = debate.advocate_arguments || [];
    this.skepticArguments = debate.skeptic_arguments || [];
    this.currentRound = debate.rounds || Math.max(this.advocateArguments.length, this.skepticArguments.length);

    // Set last arguments for continuing the debate
    this.lastAdvocateArgument = this.advocateArguments[this.advocateArguments.length - 1] || '';
    this.lastSkepticArgument = this.skepticArguments[this.skepticArguments.length - 1] || '';

    // Create a server-side debate instance for API calls
    const apiKey = this.getApiKey();
    if (apiKey) {
      try {
        const response = await fetch('/api/start-debate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey
          },
          body: JSON.stringify({ idea: debate.idea })
        });
        const data = await response.json();
        this.debateId = data.debateId;
      } catch (error) {
        console.error('Failed to create server debate instance:', error);
      }
    }

    // Switch to debate view
    this.ideaSection.classList.add('hidden');
    this.debateLayout.classList.remove('hidden');
    this.currentIdeaEl.textContent = debate.idea;
    this.roundNumberEl.textContent = this.currentRound;
    this.pauseDebateBtn.classList.add('paused');
    this.pauseDebateBtn.textContent = '▶';
    this.judgeDebateBtn.disabled = this.advocateArguments.length === 0;

    // Clear and rebuild chat from saved arguments
    this.debateChat.innerHTML = '';

    const maxRounds = Math.max(this.advocateArguments.length, this.skepticArguments.length);
    for (let i = 0; i < maxRounds; i++) {
      // Advocate message
      if (this.advocateArguments[i]) {
        this.addHistoricalMessage('advocate', this.advocateArguments[i], i + 1);
      }
      // Skeptic message
      if (this.skepticArguments[i]) {
        this.addHistoricalMessage('skeptic', this.skepticArguments[i], i + 1);
      }
    }

    // Show verdict if exists
    if (debate.verdict) {
      this.verdictPanel.classList.remove('hidden');
      this.verdictContent.innerHTML = this.formatVerdict(debate.verdict);
    } else {
      this.verdictPanel.classList.add('hidden');
    }

    this.resetThinkingSidebar();

    // Scroll to bottom of chat to show latest
    this.debateChat.scrollTop = this.debateChat.scrollHeight;
  }

  addHistoricalMessage(role, content, round) {
    const messageElement = document.createElement('div');
    messageElement.className = `debate-message ${role}-message`;
    const icon = role === 'advocate' ? '✓' : '✗';
    const name = role === 'advocate' ? 'Advocate' : 'Skeptic';
    messageElement.innerHTML = `
      <div class="message-header">
        <div class="message-icon">${icon}</div>
        <span class="message-name">${name}</span>
        <span class="message-round">Round ${round}</span>
      </div>
      <div class="message-content">${this.formatText(content)}</div>
    `;
    this.debateChat.appendChild(messageElement);
  }

  showError(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 1.5rem;
      left: 50%;
      transform: translateX(-50%);
      background: #c4553a;
      color: white;
      padding: 0.875rem 1.5rem;
      border-radius: 8px;
      font-weight: 500;
      font-size: 0.875rem;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 5000);
  }

  showMessageError(message) {
    const errorEl = document.createElement('div');
    errorEl.style.cssText = `
      background: #fdf0ed;
      border: 1px solid #c4553a;
      border-radius: 8px;
      padding: 1rem;
      color: #c4553a;
      font-size: 0.875rem;
      margin: 0.5rem 0;
    `;
    errorEl.textContent = message;
    this.debateChat.appendChild(errorEl);
  }

  scrollToBottom(container) {
    container.scrollTop = container.scrollHeight;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // CLARIFICATION METHODS
  // ============================================

  async checkForClarification(draftResponse) {
    console.log('🔍 Checking for clarification needed...');
    try {
      const response = await fetch('/api/check-facts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.getApiKey()
        },
        body: JSON.stringify({
          debateId: this.debateId,
          draftResponse,
          idea: this.currentIdea // Pass idea as fallback
        })
      });

      if (!response.ok) {
        console.error('Fact check failed:', response.status);
        return null;
      }

      const result = await response.json();
      console.log('🔍 Fact check result:', result);
      return result.needsClarification ? result : null;
    } catch (error) {
      console.error('Fact check error:', error);
      return null;
    }
  }

  showClarificationModal(claim, question) {
    this.clarificationClaim.textContent = `"${claim}"`;
    this.clarificationQuestion.textContent = question;
    this.clarificationAnswer.value = '';
    this.clarificationModal.classList.remove('hidden');
    this.clarificationAnswer.focus();

    // Pause the debate while waiting for clarification
    this.isPaused = true;
    this.pauseDebateBtn.textContent = '▶';
    this.pauseDebateBtn.title = 'Resume';
  }

  hideClarificationModal() {
    this.clarificationModal.classList.add('hidden');
  }

  submitClarification() {
    const answer = this.clarificationAnswer.value.trim();
    if (!answer) {
      this.clarificationAnswer.focus();
      return;
    }

    const question = this.clarificationQuestion.textContent;

    // Check if this is a pre-debate clarification
    if (this.isPreDebateClarification) {
      // Store the answer
      this.preDebateClarifications.push({ question, answer });

      // Remove the answered question and show next
      this.pendingPreDebateQuestions.shift();
      this.showNextPreDebateQuestion();
      return;
    }

    // In-debate clarification flow
    this.clarifications.push({ question, answer });

    this.hideClarificationModal();

    // Resume with clarification
    this.resumeAfterClarification();
  }

  skipClarification() {
    // Check if this is a pre-debate clarification
    if (this.isPreDebateClarification) {
      // Skip this question and show next
      this.pendingPreDebateQuestions.shift();
      this.showNextPreDebateQuestion();
      return;
    }

    this.hideClarificationModal();

    // Resume without clarification
    this.resumeAfterClarification();
  }

  resumeAfterClarification() {
    // Unpause and continue the debate
    this.isPaused = false;
    this.pauseDebateBtn.textContent = '⏸';
    this.pauseDebateBtn.title = 'Pause';

    // If we have a pending turn, retry it
    if (this.pendingClarification) {
      const { role, previousArgument, retryCallback } = this.pendingClarification;
      this.pendingClarification = null;
      retryCallback();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.authManager = new AuthManager();
  window.fileManager = new FileManager();
  window.debateArena = new DebateArena();
});
