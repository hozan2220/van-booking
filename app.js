require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const ejs = require('ejs');
const events = require('events');
const completionInProgress = new Set();
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const eventEmitter = new events.EventEmitter();


const ADMIN_USERS = [
    'hozan.fattah@drd-me.org',
    'ahmed.hussein@drd-me.org',
    'bashar.al-ali@drd-me.org',
    'mohammad.ahmad@drd-me.org',
    // Add more admin emails as needed
];
const requireAdmin = async (req, res, next) => {
    // First ensure the user is authenticated
    const token = req.headers.authorization?.split(' ')[1] || req.cookies['sb-access-token'];
    
    if (!token) {
        return res.redirect('/login');
    }

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            res.clearCookie('sb-access-token');
            res.clearCookie('sb-refresh-token');
            return res.redirect('/login');
        }

        // Check if user is in admin list
        if (!ADMIN_USERS.includes(user.email)) {
            return res.status(403).render('error', { 
                message: 'Access Denied: Admin privileges required',
                error: 'You do not have permission to access this page. Please contact an administrator if you believe this is an error.'
            });
        }

        req.user = user;
        req.isAdmin = true; // Set admin flag for use in templates
        next();
    } catch (err) {
        console.error('Admin auth error:', err);
        res.clearCookie('sb-access-token');
        res.clearCookie('sb-refresh-token');
        res.redirect('/login');
    }
};

// Helper function to check if user is admin (for use in other parts of the app)
const isUserAdmin = (userEmail) => {
    return ADMIN_USERS.includes(userEmail);
};

// Initialize Supabase client
const supabaseUrl = "https://fizeafjkigphnkaeauua.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpemVhZmpraWdwaG5rYWVhdXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTE1NjAwOSwiZXhwIjoyMDcwNzMyMDA5fQ.bUtItWHTZ0jGHE0xawSoDxcKTGYhS9xt_SkDnCkhNLg";
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: {
      // Custom storage adapter for server-side
      getItem: (key) => {
        return null; // Server-side doesn't need to persist
      },
      setItem: (key, value) => {
        // Server-side doesn't need to persist
      },
      removeItem: (key) => {
        // Server-side doesn't need to persist
      }
    }
  }
});
// Updated requireAuth middleware with better AJAX handling
const requireAuth = async (req, res, next) => {
    // Skip auth for specific routes
    const publicRoutes = ['/login', '/signup', '/logout', '/debug/database', '/auth/callback'];
    const isPublicRoute = publicRoutes.some(route => req.path === route || req.path.startsWith(route));
    
    if (isPublicRoute) {
        return next();
    }

    // Try multiple token sources
    let token = req.headers.authorization?.split(' ')[1] || 
               req.cookies['sb-access-token'];
    
    // For API endpoints, don't redirect - return JSON
    const isApiRequest = req.path.startsWith('/api/') || 
                        req.path.startsWith('/book') ||
                        req.path.startsWith('/enroll') ||
                        req.path.startsWith('/check') ||
                        req.path.startsWith('/custom-trips') ||
                        req.path.startsWith('/my-bookings');

    if (!token) {
        if (isApiRequest) {
            return res.status(401).json({ 
                error: 'Unauthorized', 
                message: 'Authentication required',
                redirect: '/login'
            });
        }
        return res.redirect('/login');
    }

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            if (isApiRequest) {
                return res.status(401).json({ 
                    error: 'Invalid token', 
                    message: 'Please login again',
                    redirect: '/login'
                });
            }
            
            res.clearCookie('sb-access-token');
            res.clearCookie('sb-refresh-token');
            return res.redirect('/login');
        }

        // Check email domain
        if (!user.email.endsWith('@drd-me.org')) {
            if (isApiRequest) {
                return res.status(403).json({ 
                    error: 'Access forbidden - only @drd-me.org emails allowed' 
                });
            }
            return res.status(403).send('Access forbidden - only @drd-me.org emails allowed');
        }

        req.user = user;
        next();
    } catch (err) {
        console.error('Auth error:', err);
        
        if (isApiRequest) {
            return res.status(401).json({ 
                error: 'Authentication error', 
                message: 'Please login again',
                redirect: '/login'
            });
        }
        
        res.clearCookie('sb-access-token');
        res.clearCookie('sb-refresh-token');
        res.redirect('/login');
    }
};
const refreshTokenIfNeeded = async (req, res, next) => {
  const token = req.cookies['sb-access-token'];
  const refreshToken = req.cookies['sb-refresh-token'];
  
  if (token && refreshToken) {
    try {
      // Decode token to check expiration
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        console.log('Invalid token format');
        return next();
      }

      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = payload.exp - now;
      
      console.log(`Token expires in ${expiresIn} seconds`);
      
      // Refresh if token expires in less than 10 minutes
      if (expiresIn < 600) {
        console.log('Refreshing token...');
        const { data, error } = await supabase.auth.refreshSession({
          refresh_token: refreshToken
        });
        
        if (!error && data.session) {
          console.log('Token refreshed successfully');
          // Update cookies with new tokens
          res.cookie('sb-access-token', data.session.access_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            sameSite: 'lax',
            path: '/'
          });
          
          if (data.session.refresh_token) {
            res.cookie('sb-refresh-token', data.session.refresh_token, {
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
              sameSite: 'lax',
              path: '/'
            });
          }
        } else {
          console.log('Token refresh failed:', error);
          // Don't clear cookies here, let requireAuth handle it
        }
      }
    } catch (err) {
      console.error('Token refresh error:', err);
      // Don't block request, let requireAuth handle invalid tokens
    }
  }
  
  next();
};







// Middleware
app.use(cookieParser());
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware

app.use(refreshTokenIfNeeded);  // Add this line
app.use(requireAuth);


// 1. Fix the requireAuth middleware order and logic

// Add this helper function near the top of your app.js file (after the imports)
// Add this helper function near the top of your app.js file (after the imports)
function isBookingAllowed() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // Convert current time to minutes since midnight for easier comparison
    const currentTimeInMinutes = currentHour * 60 + currentMinute;
    const startTimeInMinutes = 5 * 60; // 8:00 AM in minutes
    const cutoffTimeInMinutes = 12 * 60; // 3:00 PM in minutes (15:00)
        console.log(`Current time in minutes: ${currentTimeInMinutes}`);

    
    // Allow bookings between 8 AM and 3 PM
    return currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes < cutoffTimeInMinutes;
}

// Add this middleware function after the isBookingAllowed function
const checkBookingTime = (req, res, next) => {
    if (!isBookingAllowed()) {
        return res.status(403).json({ 
            error: 'عذراًُ، يمكنك القيام بالحجوزات فقط من الساعة الثامنة صباحاً حتى الساعة الثالثة مساءاً.',
            allowedTime: '08:00 - 15:00'
        });
    }
    next();
};
// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Helper functions for Supabase operations
// Replace your existing loadDatabase function with this improved version
async function loadDatabase() {
    try {
        console.log('Loading database...');
        
        // Load all tables in parallel with timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database query timeout')), 30000); // 30 second timeout
        });
        
        const dataPromise = Promise.all([
            supabase.from('projects').select('*'),
            supabase.from('trips').select('*'),
            supabase.from('bookings').select('*'),
            supabase.from('destinations').select('*'),
            supabase.from('vans').select('*'),
            supabase.from('custom_trips').select('*'),
            supabase.from('custom_bookings').select('*')
        ]);
        
        const [
            projectsData,
            tripsData,
            bookingsData,
            destinationsData,
            vansData,
            customTripsData,
            customBookingsData
        ] = await Promise.race([dataPromise, timeoutPromise]);

        // Check for Supabase errors
        const errors = [
            projectsData.error,
            tripsData.error,
            bookingsData.error,
            destinationsData.error,
            vansData.error,
            customTripsData.error,
            customBookingsData.error
        ].filter(error => error);

        if (errors.length > 0) {
            console.error('Supabase errors:', errors);
            throw new Error(`Database query failed: ${errors.map(e => e.message).join(', ')}`);
        }

        // Validate data structure
        const result = {
            projects: Array.isArray(projectsData.data) ? projectsData.data : [],
            trips: Array.isArray(tripsData.data) ? tripsData.data : [],
            bookings: Array.isArray(bookingsData.data) ? bookingsData.data : [],
            destinations: Array.isArray(destinationsData.data) ? destinationsData.data : [],
            vans: Array.isArray(vansData.data) ? vansData.data : [],
            custom_trips: Array.isArray(customTripsData.data) ? customTripsData.data : [],
            custom_bookings: Array.isArray(customBookingsData.data) ? customBookingsData.data : []
        };
        
        console.log('Database loaded successfully:', {
            projects: result.projects.length,
            trips: result.trips.length,
            bookings: result.bookings.length,
            destinations: result.destinations.length,
            vans: result.vans.length,
            custom_trips: result.custom_trips.length,
            custom_bookings: result.custom_bookings.length
        });
        
        return result;
    } catch (err) {
        console.error('Error loading database:', err);
        
        // Return empty structure instead of throwing to prevent cascading failures
        return {
            projects: [],
            trips: [],
            bookings: [],
            destinations: [],
            vans: [],
            custom_trips: [],
            custom_bookings: []
        };
    }
}

// Helper function to enrich trip data
function enrichTripData(trip, db) {
    const project = db.projects.find(p => p.id === trip.projectId);
    const van = trip.vanId ? db.vans.find(v => v.id === trip.vanId) : null;
    const bookings = db.bookings.filter(b => b.tripId === trip.id);
    const vanOptions = db.vans.filter(v => v.projectId === trip.projectId);
    
    return {
        ...trip,
        projectName: project ? project.name : 'Unknown',
        van: van,
        bookings: bookings,
        passengerCount: bookings.length,
        vanOptions: vanOptions,
        isClosed: trip.isClosed || false,
        created_at: trip.created_at, // Ensure created_at is preserved
        createdAt: trip.created_at || trip.createdAt // Also provide as createdAt for consistency

    };
}

// Helper function to enrich custom trip data
function enrichCustomTripData(trip, db) {
    const project = db.projects.find(p => p.id === trip.projectId);
    const van = trip.vanId ? db.vans.find(v => v.id === trip.vanId) : null;
    const bookings = db.custom_bookings.filter(b => b.custom_tripId === trip.id);
    
    return {
        ...trip,
        projectName: project ? project.name : 'Unknown',
        van: van,
        bookings: bookings,
        passengerCount: bookings.length,
        vanOptions: db.vans.map(v => {
            const vanProject = db.projects.find(p => p.id === v.projectId);
            return {
                ...v,
                projectName: vanProject ? vanProject.name : 'Unknown'
            };
        }),
        isClosed: trip.isClosed || false,
        isCustom: true,
 created_at: trip.created_at, // Ensure created_at is preserved
        createdAt: trip.created_at || trip.createdAt // Also provide as createdAt for consistency
    };
}

// SSE endpoint
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial data
    loadDatabase().then(db => {
        res.write(`data: ${JSON.stringify({
            type: 'init',
            data: {
                projects: db.projects,
                trips: db.trips.map(trip => enrichTripData(trip, db)),
                customTrips: db.custom_trips.map(trip => enrichCustomTripData(trip, db)),
                vans: db.vans,
                bookings: db.bookings,
                customBookings: db.custom_bookings
            }
        })}\n\n`);

        // Add event listener
        const listener = (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        eventEmitter.on('update', listener);

        // Clean up on client disconnect
        req.on('close', () => {
            eventEmitter.off('update', listener);
        });
    });
});
// Login routes
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email.endsWith('@drd-me.org')) {
    return res.render('login', { error: 'Only @drd-me.org emails are allowed' });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    console.log('Login successful for:', email);
    console.log('Session expires at:', new Date(data.session.expires_at * 1000));

    // Set session cookies with proper configuration
    res.cookie('sb-access-token', data.session.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax',
      path: '/'
    });

    res.cookie('sb-refresh-token', data.session.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: 'lax',
      path: '/'
    });

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', { error: error.message || 'Login failed' });
  }
});

app.get('/logout', async (req, res) => {
  try {
    // Get current session for proper logout
    const token = req.cookies['sb-access-token'];
    if (token) {
      await supabase.auth.signOut();
    }
  } catch (error) {
    console.error('Logout error:', error);
  }
  
  // Clear all auth cookies
  res.clearCookie('sb-access-token');
  res.clearCookie('sb-refresh-token');
  res.redirect('/login');
});
// Routes
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});



app.get('/fix-database', async (req, res) => {
    try {
        const db = await loadDatabase();
        
        console.log('Before fix:', JSON.stringify(db.projects, null, 2));
        
        // Fix each project
        const updates = [];
        for (const project of db.projects) {
            let needsUpdate = false;
            const updateData = { id: project.id };
            
            // If we see the pattern where remaining_trips is 50 but should be less
            if (project.number_of_remaining_trips === 50 && !project.initial_trips) {
                updateData.initial_trips = project.number_of_remaining_trips;
                needsUpdate = true;
            }
            
            // Or if you know the specific project that should have 2 initial trips:
            if (project.name === "DCA") {
                updateData.initial_trips = 2;
                needsUpdate = true;
            }
            
            // Ensure number_of_remaining_trips exists
            if (project.number_of_remaining_trips === undefined) {
                updateData.number_of_remaining_trips = project.initial_trips || 50;
                needsUpdate = true;
            }
            
            // Ensure initial_trips exists
            if (!project.initial_trips) {
                updateData.initial_trips = 50;
                needsUpdate = true;
            }
            
            if (needsUpdate) {
                updates.push(
                    supabase.from('projects')
                        .update(updateData)
                        .eq('id', project.id)
                );
            }
        }
        
        // Execute all updates
        await Promise.all(updates);
        
        // Reload to get updated data
        const updatedDb = await loadDatabase();
        console.log('After fix:', JSON.stringify(updatedDb.projects, null, 2));
        
        res.json({ 
            success: true, 
            message: 'Database fixed',
            projects: updatedDb.projects 
        });
    } catch (error) {
        console.error('Error fixing database:', error);
        res.status(500).json({ error: 'Failed to fix database' });
    }
});
// Add these routes near your other auth routes (around line 120)

// Signup routes
// Update your signup route to this:
app.get('/signup', (req, res) => {
  res.render('signup', { 
    error: null,
    success: false,
    message: null
  });
});

// 6. Update signup route for consistent session handling
// 4. Fixed signup route
app.post('/signup', async (req, res) => {
    const { email, password, displayName } = req.body;
    
    if (!email.endsWith('@drd-me.org')) {
        return res.render('signup', { 
            error: 'Only @drd-me.org emails are allowed',
            success: false,
            message: null
        });
    }

    if (!displayName || displayName.trim() === '') {
        return res.render('signup', {
            error: 'Display name is required',
            success: false,
            message: null
        });
    }

    if (!password || password.length < 6) {
        return res.render('signup', {
            error: 'Password must be at least 6 characters',
            success: false,
            message: null
        });
    }

    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: `${req.protocol}://${req.get('host')}/dashboard`,
                data: {
                    display_name: displayName.trim()
                }
            }
        });

        if (error) throw error;

        // If session is created immediately (email confirmation disabled)
        if (data.session) {
            console.log('Signup successful with immediate session for:', email);
            
            res.cookie('sb-access-token', data.session.access_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 7 * 24 * 60 * 60 * 1000,
                sameSite: 'lax',
                path: '/'
            });

            res.cookie('sb-refresh-token', data.session.refresh_token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 30 * 24 * 60 * 60 * 1000,
                sameSite: 'lax',
                path: '/'
            });

            return res.redirect('/dashboard');
        }

        // If email confirmation is required
        res.render('signup', { 
            error: null,
            success: true,
            message: 'Check your email for a confirmation link'
        });

    } catch (error) {
        console.error('Signup error:', error);
        
        let errorMessage = 'Signup failed. Please try again.';
        if (error.message.includes('User already registered')) {
            errorMessage = 'This email is already registered. Please login instead.';
        }

        res.render('signup', { 
            error: errorMessage,
            success: false,
            message: null
        });
    }
});
app.get('/dashboard', async (req, res) => {
  try {
    const db = await loadDatabase();
    
    // Debug logging - Add these lines to see what's happening
    console.log('Dashboard route - User:', req.user ? req.user.email : 'No user');
    console.log('Dashboard route - ADMIN_USERS:', ADMIN_USERS);
    
    // Check if user is admin
    const isAdmin = req.user ? isUserAdmin(req.user.email) : false;
    console.log('Dashboard route - isAdmin result:', isAdmin);
    
    const templateData = {
      projects: db.projects.map(p => ({
        id: p.id,
        name: p.name,
        journeyCount: p.number_of_remaining_trips || 0,
        locationId: p.locationId || null,
        initial_trips: p.initial_trips || 50,
        number_of_remaining_trips: p.number_of_remaining_trips || 0
      })),
      destinations: db.destinations || [],
      trips: db.trips || [],
      customTrips: db.custom_trips || [],
      customBookings: db.custom_bookings || [],
      user: req.user, // Pass user info to template
      isAdmin: isAdmin // Pass admin status to template
    };
    
    // Debug the template data being sent
    console.log('Dashboard route - Template data isAdmin:', templateData.isAdmin);
    console.log('Dashboard route - Template data user:', templateData.user ? templateData.user.email : 'No user in template');
    
    res.render('dashboard', templateData);
  } catch (error) {
    console.error('Error loading dashboard:', error);
    res.status(500).render('error', { message: 'Failed to load dashboard' });
  }
});
app.get('/all-bookings/:date', async (req, res) => {
    const date = req.params.date;
    const excludeCompleted = req.query.excludeCompleted === 'true';
    
    try {
        const db = await loadDatabase();
        
        // Get regular trips for the specified date
        let regularTrips = db.trips.filter(trip => 
            ((trip.goDate === date && !trip.isReturnTrip) || 
            (trip.returnDate === date && trip.isReturnTrip))
        );
        
        // Get custom trips for the specified date
        let customTrips = db.custom_trips.filter(trip => 
            ((trip.goDate === date && !trip.isReturnTrip) || 
            (trip.returnDate === date && trip.isReturnTrip))
        );
        
        // Filter out completed trips if requested
        if (excludeCompleted) {
            regularTrips = regularTrips.filter(trip => !trip.isCompleted);
            customTrips = customTrips.filter(trip => !trip.isCompleted);
        }
        
        // Enrich regular trips
        const enrichedRegularTrips = regularTrips.map(trip => {
            const project = db.projects.find(p => p.id === trip.projectId);
            const van = trip.vanId ? db.vans.find(v => v.id === trip.vanId) : null;
            const bookings = db.bookings.filter(b => b.tripId === trip.id);
            
            return {
                tripId: trip.id,
                vanId: trip.vanId,
                driver: van ? van.driver : 'Not assigned',
                destination: trip.destination,
                projectName: project ? project.name : 'Unknown',
                date: trip.isReturnTrip ? trip.returnDate : trip.goDate,
                time: trip.isReturnTrip ? trip.returnTime : trip.goTime,
                isReturnTrip: trip.isReturnTrip,
                passengers: bookings.map(b => ({ name: b.name, email: b.email })),
                passengerCount: bookings.length,
                canComplete: bookings.length >= 8 && !trip.isCompleted && trip.vanId !== null,
                isCompleted: trip.isCompleted,
                needsVan: trip.vanId === null,
                isClosed: trip.isClosed || false,
                isCustom: false,
                createdAt: trip.createdAt
            };
        });
        
        // Enrich custom trips
        const enrichedCustomTrips = customTrips.map(trip => {
            const project = db.projects.find(p => p.id === trip.projectId);
            const van = trip.vanId ? db.vans.find(v => v.id === trip.vanId) : null;
            const bookings = db.custom_bookings.filter(b => b.custom_tripId === trip.id);
            
            return {
                tripId: trip.id,
                vanId: trip.vanId,
                driver: van ? van.driver : 'Not assigned',
                destination: trip.destination,
                projectName: project ? project.name : 'Unknown',
                date: trip.isReturnTrip ? trip.returnDate : trip.goDate,
                time: trip.isReturnTrip ? trip.returnTime : trip.goTime,
                isReturnTrip: trip.isReturnTrip,
                passengers: bookings.map(b => ({ name: b.name, email: b.email })),
                passengerCount: bookings.length,
                canComplete: bookings.length >= 8 && !trip.isCompleted && trip.vanId !== null,
                isCompleted: trip.isCompleted,
                needsVan: trip.vanId === null,
                isClosed: trip.isClosed || false,
                isCustom: true,
                createdAt: trip.createdAt
            };
        });
        
        // Combine both arrays and sort by createdAt (newest first)
        const allTrips = [...enrichedRegularTrips, ...enrichedCustomTrips]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        res.json(allTrips);
    } catch (error) {
        console.error('Error fetching all bookings:', error);
        res.status(500).json({ error: 'Failed to fetch all bookings' });
    }
});
// Custom trip booking route
app.post('/book-custom', checkBookingTime ,async (req, res) => {
    try {
        // Get authenticated user
        const token = req.headers.authorization?.split(' ')[1] || req.cookies['sb-access-token'];
        if (!token) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }

        const displayName = user.user_metadata?.display_name || user.email.split('@')[0];
        const { projectId, destination, goDate, returnDate, goTime, returnTime } = req.body;
        
        // Validate dates
        if (new Date(returnDate) < new Date(goDate)) {
            return res.status(400).json({ error: 'Return date cannot be before departure date' });
        }

        // Validate same-day times
        if (goDate === returnDate && returnTime <= goTime) {
            return res.status(400).json({ error: 'Return time must be after departure time for same-day trips' });
        }

        // Find the project
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('*')
            .eq('id', projectId)
            .single();

        if (projectError || !project) {
            return res.status(400).json({ error: 'Invalid project' });
        }

        // Function to find or create custom trip
        const findOrCreateCustomTrip = async (isReturnTrip) => {
            const tripDate = isReturnTrip ? returnDate : goDate;
            const tripTime = isReturnTrip ? returnTime : goTime;
            
            // Look for existing trips
            const { data: existingTrips, error: tripsError } = await supabase
                .from('custom_trips')
                .select('*')
                .eq('destination', destination)
                .eq(isReturnTrip ? 'returnDate' : 'goDate', tripDate)
                .eq('isReturnTrip', isReturnTrip)
                .eq('isCompleted', false)
                .eq('isClosed', false);

            if (tripsError) throw tripsError;

            // Check for available capacity in existing trips
            for (const trip of existingTrips) {
                const { data: tripBookings, error: bookingsError } = await supabase
                    .from('custom_bookings')
                    .select('*')
                    .eq('custom_tripId', trip.id);

                if (bookingsError) throw bookingsError;

                if (tripBookings.length < 8) {
                    console.log(`Joining existing ${isReturnTrip ? 'return' : 'departure'} trip ${trip.id}`);
                    return { tripId: trip.id, isNew: false };
                }
            }

            // No available capacity - create new trip
            const newTripId = uuidv4();
            const newTrip = {
                id: newTripId,
                projectId: projectId,
                destination: destination.trim(),
                vanId: null,
                goDate: goDate,
                returnDate: returnDate,
                goTime: goTime,
                returnTime: returnTime,
                isReturnTrip: isReturnTrip,
                isCompleted: false,
                isClosed: false,
                createdAt: new Date().toISOString()
            };

            const { error: insertError } = await supabase
                .from('custom_trips')
                .insert(newTrip);

            if (insertError) throw insertError;

            console.log(`Created new ${isReturnTrip ? 'return' : 'departure'} trip ${newTripId}`);
            return { tripId: newTripId, isNew: true };
        };

        // Find or create departure and return trips
        const departureResult = await findOrCreateCustomTrip(false);
        const returnResult = await findOrCreateCustomTrip(true);

        // Create bookings for both trips using user's display name
        const departureBooking = {
            id: uuidv4(),
            name: displayName,
            email: user.email,
            custom_tripId: departureResult.tripId,
            createdAt: new Date().toISOString()
        };

        const returnBooking = {
            id: uuidv4(),
            name: displayName,
            email: user.email,
            custom_tripId: returnResult.tripId,
            createdAt: new Date().toISOString()
        };

        // Insert bookings
        const { error: bookingsError } = await supabase
            .from('custom_bookings')
            .insert([departureBooking, returnBooking]);

        if (bookingsError) throw bookingsError;

        console.log(`Bookings created: departure trip ${departureResult.tripId}, return trip ${returnResult.tripId}`);

        // Emit SSE events for passenger additions
        if (!departureResult.isNew) {
            const { data: departureBookings, error: depBookingsError } = await supabase
                .from('custom_bookings')
                .select('*')
                .eq('custom_tripId', departureResult.tripId);

            if (depBookingsError) throw depBookingsError;

            eventEmitter.emit('update', {
                type: 'custom-passenger-added',
                tripId: departureResult.tripId,
                passengerName: displayName,
                passengerCount: departureBookings.length
            });
        }

        if (!returnResult.isNew) {
            const { data: returnBookings, error: retBookingsError } = await supabase
                .from('custom_bookings')
                .select('*')
                .eq('custom_tripId', returnResult.tripId);

            if (retBookingsError) throw retBookingsError;

            eventEmitter.emit('update', {
                type: 'custom-passenger-added',
                tripId: returnResult.tripId,
                passengerName: displayName,
                passengerCount: returnBookings.length
            });
        }

        // Emit SSE events for new trips if any were created
        if (departureResult.isNew || returnResult.isNew) {
            const createdTrips = [];
            const db = await loadDatabase();
            
            if (departureResult.isNew) {
                const departureTrip = db.custom_trips.find(t => t.id === departureResult.tripId);
                if (departureTrip) createdTrips.push(enrichCustomTripData(departureTrip, db));
            }
            if (returnResult.isNew) {
                const returnTrip = db.custom_trips.find(t => t.id === returnResult.tripId);
                if (returnTrip) createdTrips.push(enrichCustomTripData(returnTrip, db));
            }
            
            if (createdTrips.length > 0) {
                eventEmitter.emit('update', {
                    type: 'custom-trip-created',
                    trips: createdTrips
                });
            }
        }

     let message = `تم فتح رحلة مخصصة الى ${destination}! `;
        if (!departureResult.isNew && !returnResult.isNew) {
            message += 'واضافتها الى الرحلات الموجودة مسبقاً.';
        } else if (!departureResult.isNew || !returnResult.isNew) {
            message += 'والانضمام لها بنجاح.';
        } else {
            message += ' ';
        }

        res.json({
            success: true,
            message: message,
            trips: [departureResult.tripId, returnResult.tripId],
            joinedExisting: {
                departure: !departureResult.isNew,
                return: !returnResult.isNew
            }
        });
    } catch (error) {
        console.error('Error booking custom trip:', error);
        res.status(500).json({ error: 'أنت بالفعل من ضمن هذه الرحلة' });
    }
});

// Get all active custom trips
app.get('/custom-trips', async (req, res) => {
    try {
        const db = await loadDatabase();
        const activeCustomTrips = db.custom_trips
            .filter(trip => !trip.isCompleted)
            .map(trip => enrichCustomTripData(trip, db));
        res.json(activeCustomTrips);
    } catch (error) {
        console.error('Error fetching custom trips:', error);
        res.status(500).json({ error: 'Failed to fetch custom trips' });
    }
});
app.get('/debug/session', (req, res) => {
  const token = req.cookies['sb-access-token'];
  const refreshToken = req.cookies['sb-refresh-token'];
  
  if (!token) {
    return res.json({
      hasToken: false,
      hasRefreshToken: !!refreshToken,
      cookies: Object.keys(req.cookies)
    });
  }
  
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    const now = Math.floor(Date.now() / 1000);
    
    res.json({
      hasToken: true,
      hasRefreshToken: !!refreshToken,
      tokenExp: payload.exp,
      currentTime: now,
      expiresIn: payload.exp - now,
      user: payload.sub,
      email: payload.email,
      isExpired: payload.exp < now
    });
  } catch (err) {
    res.json({
      hasToken: true,
      hasRefreshToken: !!refreshToken,
      tokenParseError: err.message
    });
  }
});

// 7. Add auth callback route for email confirmations
app.get('/auth/callback', async (req, res) => {
  const { access_token, refresh_token } = req.query;
  
  if (access_token && refresh_token) {
    console.log('Setting tokens from auth callback');
    
    res.cookie('sb-access-token', access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      path: '/'
    });

    res.cookie('sb-refresh-token', refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      path: '/'
    });
  }
  
  res.redirect('/dashboard');
});
// Enroll in custom trip
app.post('/enroll-custom-trip/:tripId', checkBookingTime, async (req, res) => {
    const { tripId } = req.params;
    
    try {
        // Get authenticated user
        const token = req.headers.authorization?.split(' ')[1] || req.cookies['sb-access-token'];
        if (!token) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }

        const displayName = user.user_metadata?.display_name || user.email.split('@')[0];
        
        // Check if this is a custom trip
        const { data: customTripCheck, error: customCheckError } = await supabase
            .from('custom_trips')
            .select('*')
            .eq('id', tripId)
            .single();

        if (customCheckError || !customTripCheck) {
            return res.status(404).json({ error: 'لم يتم العثور على الرحلة، من فضلك حدث الصفحة لترى آخر التحديثات' });
        }

        if (customTripCheck.isCompleted) {
            return res.status(400).json({ error: 'Cannot enroll in a completed custom trip' });
        }

        if (customTripCheck.isClosed) {
            return res.status(400).json({ error: 'Cannot enroll in a closed custom trip' });
        }

        // Check capacity
        const { data: tripBookings, error: bookingsError } = await supabase
            .from('custom_bookings')
            .select('*')
            .eq('custom_tripId', tripId);

        if (bookingsError) throw bookingsError;

        if (tripBookings.length >= 8) {
            return res.status(400).json({ error: 'This custom trip is already full' });
        }

        // Create booking with user's display name
        const newBooking = {
            id: uuidv4(),
            name: displayName,
            email: user.email,
            custom_tripId: tripId,
            createdAt: new Date().toISOString()
        };

        const { error: insertError } = await supabase
            .from('custom_bookings')
            .insert(newBooking);

        if (insertError) throw insertError;

        // Emit SSE event with the passenger name
        eventEmitter.emit('update', {
            type: 'custom-passenger-added',
            tripId: tripId,
            passengerName: displayName,
            passengerCount: tripBookings.length + 1
        });

        res.json({
            success: true,
            booking: newBooking
        });
    } catch (error) {
        console.error('Error enrolling in custom trip:', error);
        res.status(500).json({ error: 'أنت بالفعل موجود في  هذه الرحلة' });
    }
});
// Add this route to get user's trips
app.get('/user-trips', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1] || req.cookies['sb-access-token'];
        if (!token) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }

        const db = await loadDatabase();
        
        // Get regular trips where user has bookings
        const userRegularBookings = db.bookings.filter(b => b.email === user.email);
        const regularTrips = db.trips
            .filter(trip => userRegularBookings.some(b => b.tripId === trip.id))
            .map(trip => {
                const project = db.projects.find(p => p.id === trip.projectId);
                const van = trip.vanId ? db.vans.find(v => v.id === trip.vanId) : null;
                return {
                    ...trip,
                    projectName: project ? project.name : 'Unknown',
                    van: van,
                    isCustom: false
                };
            });

        // Get custom trips where user has bookings
        const userCustomBookings = db.custom_bookings.filter(b => b.email === user.email);
        const customTrips = db.custom_trips
            .filter(trip => userCustomBookings.some(b => b.custom_tripId === trip.id))
            .map(trip => {
                const project = db.projects.find(p => p.id === trip.projectId);
                const van = trip.vanId ? db.vans.find(v => v.id === trip.vanId) : null;
                return {
                    ...trip,
                    projectName: project ? project.name : 'Unknown',
                    van: van,
                    isCustom: true
                };
            });

        // Combine and sort by date
        const allTrips = [...regularTrips, ...customTrips].sort((a, b) => {
            const dateA = a.isReturnTrip ? a.returnDate : a.goDate;
            const dateB = b.isReturnTrip ? b.returnDate : b.goDate;
            return new Date(dateA) - new Date(dateB);
        });

        res.json(allTrips);
    } catch (error) {
        console.error('Error fetching user trips:', error);
        res.status(500).json({ error: 'Failed to fetch user trips' });
    }
});

// Add this route to cancel bookings
app.post('/cancel-booking/:tripId', async (req, res) => {
    const { tripId } = req.params;
    const { isCustom } = req.body;
    
    try {
        const token = req.headers.authorization?.split(' ')[1] || req.cookies['sb-access-token'];
        if (!token) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }

        if (isCustom) {
            // Cancel custom trip booking
            const { data: booking, error: bookingError } = await supabase
                .from('custom_bookings')
                .select('*')
                .eq('custom_tripId', tripId)
                .eq('email', user.email)
                .single();

            if (bookingError || !booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }

            const { error: deleteError } = await supabase
                .from('custom_bookings')
                .delete()
                .eq('id', booking.id);

            if (deleteError) throw deleteError;

            // Get updated passenger count
            const { data: remainingBookings, error: countError } = await supabase
                .from('custom_bookings')
                .select('*')
                .eq('custom_tripId', tripId);

            if (countError) throw countError;

            // Emit SSE event
            eventEmitter.emit('update', {
            type: 'custom-booking-deleted',
            tripId: tripId,
            bookingId: booking.id,

            remainingPassengerCount: remainingBookings.length,
            passengerName: booking.name
        });

            res.json({ 
                success: true,
                passengerCount: remainingBookings.length
            });
        } else {
            // Cancel regular trip booking
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .select('*')
                .eq('tripId', tripId)
                .eq('email', user.email)
                .single();

            if (bookingError || !booking) {
                return res.status(404).json({ error: 'Booking not found' });
            }

            const { error: deleteError } = await supabase
                .from('bookings')
                .delete()
                .eq('id', booking.id);

            if (deleteError) throw deleteError;

            // Get updated passenger count
            const { data: remainingBookings, error: countError } = await supabase
                .from('bookings')
                .select('*')
                .eq('tripId', tripId);

            if (countError) throw countError;

            // Emit SSE event
             eventEmitter.emit('update', {
            type: 'booking-deleted',
            tripId: tripId,
            bookingId: booking.id,
            remainingPassengerCount: remainingBookings.length,
            passengerName: booking.name
        });

            res.json({ 
                success: true,
                passengerCount: remainingBookings.length
            });
        }
    } catch (error) {
        console.error('Error cancelling booking:', error);
        res.status(500).json({ error: 'Failed to cancel booking' });
    }
});
// Edit project endpoint
app.post('/edit-project/:id', async (req, res) => {
    const { id } = req.params;
    const { name, locationId, initial_trips, number_of_remaining_trips } = req.body;
    
    try {
        const db = await loadDatabase();
        
        const project = db.projects.find(p => p.id === id);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }
        
        // Validate input
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Project name is required' });
        }
        
        // Check if location exists
        if (locationId && !db.destinations.some(d => d.id === locationId)) {
            return res.status(400).json({ error: 'Invalid location' });
        }
        
        // Validate trips numbers
        if (initial_trips && isNaN(initial_trips)) {
            return res.status(400).json({ error: 'Initial trips must be a number' });
        }
        
        if (number_of_remaining_trips && isNaN(number_of_remaining_trips)) {
            return res.status(400).json({ error: 'Remaining trips must be a number' });
        }
        
        const oldName = project.name;
        const oldLocationId = project.locationId;
        const oldInitialTrips = project.initial_trips;
        const oldRemainingTrips = project.number_of_remaining_trips;
        
        const updateData = {
            name: name.trim(),
            locationId: locationId || null
        };
        
        // Only update trips if they were provided
        if (initial_trips !== undefined) {
            updateData.initial_trips = parseInt(initial_trips);
        }
        
        if (number_of_remaining_trips !== undefined) {
            updateData.number_of_remaining_trips = parseInt(number_of_remaining_trips);
        }
        
        // Update in database
        const { error } = await supabase
            .from('projects')
            .update(updateData)
            .eq('id', id);

        if (error) throw error;
        
        // Emit SSE event
        eventEmitter.emit('update', {
            type: 'project-updated',
            projectId: id,
            oldName,
            newName: updateData.name,
            oldLocationId,
            newLocationId: updateData.locationId,
            oldInitialTrips,
            newInitialTrips: updateData.initial_trips,
            oldRemainingTrips,
            newRemainingTrips: updateData.number_of_remaining_trips
        });
        
        res.json({ success: true, project: { ...project, ...updateData } });
    } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({ error: 'Failed to update project' });
    }
});

// Edit van endpoint
app.post('/edit-van/:id', async (req, res) => {
    const { id } = req.params;
    const { driver, projectId } = req.body;
    
    try {
        const db = await loadDatabase();
        
        const van = db.vans.find(v => v.id === id);
        if (!van) {
            return res.status(404).json({ error: 'Van not found' });
        }
        
        // Validate input
        if (!driver || driver.trim() === '') {
            return res.status(400).json({ error: 'Driver name is required' });
        }
        
        // Check if project exists
        if (!db.projects.some(p => p.id === projectId)) {
            return res.status(400).json({ error: 'Invalid project' });
        }
        
        const oldDriver = van.driver;
        const oldProjectId = van.projectId;
        
        const updateData = {
            driver: driver.trim(),
            projectId: projectId
        };
        
        // Update in database
        const { error } = await supabase
            .from('vans')
            .update(updateData)
            .eq('id', id);

        if (error) throw error;
        
        // Emit SSE event
        eventEmitter.emit('update', {
            type: 'van-updated',
            vanId: id,
            oldDriver,
            newDriver: updateData.driver,
            oldProjectId,
            newProjectId: updateData.projectId
        });
        
        res.json({ success: true, van: { ...van, ...updateData } });
    } catch (error) {
        console.error('Error updating van:', error);
        res.status(500).json({ error: 'Failed to update van' });
    }
});

app.get('/organizer', requireAdmin, async (req, res) => {
    try {
        const db = await loadDatabase();
        
        // Enrich both regular and custom trips
        const regularTrips = db.trips.filter(t => !t.isCompleted).map(trip => enrichTripData(trip, db));
        const customTrips = db.custom_trips.filter(t => !t.isCompleted).map(trip => enrichCustomTripData(trip, db));
        
        // Combine trips and sort by created_at (newest first)
        const allTrips = [...regularTrips, ...customTrips].sort((a, b) => {
            // Handle created_at sorting - newest first (descending order)
            const dateA = new Date(a.created_at || a.createdAt || '1970-01-01T00:00:00.000Z');
            const dateB = new Date(b.created_at || b.createdAt || '1970-01-01T00:00:00.000Z');
            return dateB - dateA; // Descending order (newest first)
        });

        res.render('organizer', { 
            projects: db.projects.map(p => ({
                ...p,
                journeyCount: p.number_of_remaining_trips
            })),
            trips: allTrips,
            vans: db.vans,
            bookings: db.bookings,
            customBookings: db.custom_bookings
        });
    } catch (error) {
        console.error('Error loading organizer view:', error);
        res.status(500).render('error', { message: 'Failed to load organizer view' });
    }
});
app.get('/api/admin-status', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1] || req.cookies['sb-access-token'];
        
        if (!token) {
            return res.json({ isAdmin: false });
        }

        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            return res.json({ isAdmin: false });
        }

        res.json({ 
            isAdmin: isUserAdmin(user.email),
            email: user.email
        });
    } catch (err) {
        console.error('Error checking admin status:', err);
        res.json({ isAdmin: false });
    }
});
app.get('/reports', requireAdmin, async (req, res) => {
    try {
        const db = await loadDatabase();
        
        // Filter completed regular trips
        const completedTrips = db.trips.filter(trip => trip.isCompleted)
            .map(trip => enrichTripData(trip, db));
        
        // Filter completed custom trips
        const completedCustomTrips = db.custom_trips.filter(trip => trip.isCompleted)
            .map(trip => enrichCustomTripData(trip, db));
        
        // Combine both types of trips
        const allCompletedTrips = [...completedTrips, ...completedCustomTrips]
            .sort((a, b) => {
                const dateA = new Date(a.isReturnTrip ? a.returnDate : a.goDate);
                const dateB = new Date(b.isReturnTrip ? b.returnDate : b.goDate);
                return dateB - dateA; // Most recent first
            });
        
        res.render('reports', { 
            trips: allCompletedTrips,
            projects: db.projects,
            vans: db.vans
        });
    } catch (error) {
        console.error('Error loading reports view:', error);
        res.status(500).render('error', { message: 'Failed to load reports view' });
    }
});

app.post('/assign-van/:tripId', async (req, res) => {
    const { tripId } = req.params;
    const { vanId } = req.body;
    
    try {
        const db = await loadDatabase();
        
        // Check if this is a custom trip
        const isCustomTrip = db.custom_trips.some(t => t.id === tripId);
        const trip = isCustomTrip 
            ? db.custom_trips.find(t => t.id === tripId)
            : db.trips.find(t => t.id === tripId);
        
        if (!trip) {
            return res.status(404).json({ error: 'لم يتم العثور على الرحلة، من فضلك حدث الصفحة لترى آخر التحديثات' });
        }
        
        const van = db.vans.find(v => v.id === vanId);
        if (!van) {
            return res.status(404).json({ error: 'Van not found' });
        }
        
        // FIXED: SKIP ALL CONFLICT CHECKING FOR CUSTOM TRIPS
        if (!isCustomTrip) {
            // Only do conflict checking for regular trips
            const tripDate = trip.isReturnTrip ? trip.returnDate : trip.goDate;
            
            const conflictingTrips = db.trips.filter(existingTrip => {
                if (existingTrip.id === trip.id || existingTrip.isCompleted) {
                    return false;
                }
                
                if (!existingTrip.vanId || existingTrip.vanId !== vanId) {
                    return false;
                }
                
                const existingTripDate = existingTrip.isReturnTrip ? existingTrip.returnDate : existingTrip.goDate;
                
                if (tripDate !== existingTripDate) {
                    return false;
                }
                
                if (!trip.isReturnTrip && !existingTrip.isReturnTrip) {
                    return true;
                }
                
                if (trip.isReturnTrip && existingTrip.isReturnTrip) {
                    return true;
                }
                
                return false;
            });
            
            if (conflictingTrips.length > 0) {
                const conflictType = trip.isReturnTrip ? 'عودة' : 'ذهاب';
                const conflictingTrip = conflictingTrips[0];
                const conflictDestination = conflictingTrip.destination;
                const sameDestination = conflictDestination === trip.destination;
                
                let errorMessage;
                if (sameDestination) {
                    errorMessage = `هذا الفان لديه رحلة  ${conflictType}  ${conflictDestination} في نفس التاريخ ${tripDate}.`;
                } else {
                    errorMessage = `Van ${vanId} is already assigned to a ${conflictType} trip to ${conflictDestination} on ${tripDate}. A van can only handle one ${conflictType} trip per day.`;
                }
                
                return res.status(400).json({ error: errorMessage });
            }
            
            // Check if van belongs to the same project as the trip (only for regular trips)
            if (van.projectId !== trip.projectId) {
                return res.status(400).json({ error: 'Van can only be assigned to trips from the same project' });
            }
        }
        
        // Update the trip with the van assignment
        const { error } = await supabase
            .from(isCustomTrip ? 'custom_trips' : 'trips')
            .update({ vanId: vanId })
            .eq('id', tripId);

        if (error) throw error;
        
        // Emit SSE event
        eventEmitter.emit('update', {
            type: 'van-assigned',
            tripId: tripId,
            vanId: vanId,
            date: trip.isReturnTrip ? trip.returnDate : trip.goDate,
            isCustom: isCustomTrip
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error assigning van:', error);
        res.status(500).json({ error: 'Failed to assign van' });
    }
});

app.post('/close-trip/:tripId', async (req, res) => {
    const { tripId } = req.params;
    
    try {
        const db = await loadDatabase();
        
        // Check if this is a custom trip
        const isCustomTrip = db.custom_trips.some(t => t.id === tripId);
        const trip = isCustomTrip 
            ? db.custom_trips.find(t => t.id === tripId)
            : db.trips.find(t => t.id === tripId);
        
        if (!trip) {
            return res.status(404).json({ error: 'لم يتم العثور على الرحلة، من فضلك حدث الصفحة لترى آخر التحديثات' });
        }

        // Update the trip
        const { error } = await supabase
            .from(isCustomTrip ? 'custom_trips' : 'trips')
            .update({ isClosed: true })
            .eq('id', tripId);

        if (error) throw error;

        // Emit SSE event
        eventEmitter.emit('update', {
            type: 'trip-closed',
            tripId: tripId,
            isCustom: isCustomTrip
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error closing trip:', error);
        res.status(500).json({ error: 'Failed to close trip' });
    }
});
// Get user's bookings
// Get user's bookings
app.get('/my-bookings', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1] || req.cookies['sb-access-token'];
        if (!token) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }
        
        // Get regular bookings with van/driver information, ordered by created_at DESC (newest first)
        const { data: regularBookings, error: regularError } = await supabase
            .from('bookings')
            .select(`
                *, 
                trips(
                    *, 
                    vans(driver)
                )
            `)
            .eq('email', user.email)
            .order('createdAt', { ascending: false });
        
        if (regularError) throw regularError;
        
        // Get custom bookings with van/driver information, ordered by created_at DESC (newest first)
        const { data: customBookings, error: customError } = await supabase
            .from('custom_bookings')
            .select(`
                *, 
                custom_trips(
                    *, 
                    vans(driver)
                )
            `)
            .eq('email', user.email)
            .order('createdAt', { ascending: false });
        
        if (customError) throw customError;
        
        // Process the data to flatten van information
        const processedRegularBookings = regularBookings?.map(booking => ({
            ...booking,
            trips: {
                ...booking.trips,
                driver: booking.trips.vans?.driver || null,
                van: booking.trips.vans || null
            }
        })) || [];
        
        const processedCustomBookings = customBookings?.map(booking => ({
            ...booking,
            custom_trips: {
                ...booking.custom_trips,
                driver: booking.custom_trips.vans?.driver || null,
                van: booking.custom_trips.vans || null
            }
        })) || [];
        
        res.json({
            regularBookings: processedRegularBookings,
            customBookings: processedCustomBookings
        });
    } catch (error) {
        console.error('Error fetching user bookings:', error);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});
// Delete booking
app.post('/delete-booking/:id', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1] || req.cookies['sb-access-token'];
        if (!token) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }
        const { id } = req.params;
        const { isCustom } = req.body;
        
        let tripId;
        let wasLastBooking = false;
        let remainingPassengerCount = 0;
        
        if (isCustom) {
            // Delete custom booking
            const { data: booking, error: bookingError } = await supabase
                .from('custom_bookings')
                .select('*')
                .eq('id', id)
                .eq('email', user.email)
                .single();
            if (bookingError || !booking) {
                return res.status(404).json({ error: 'Booking not found or unauthorized' });
            }
            
            tripId = booking.custom_tripId;
            
            const { error: deleteError } = await supabase
                .from('custom_bookings')
                .delete()
                .eq('id', id);
            if (deleteError) throw deleteError;
            
            // Check remaining bookings for this trip
            const { data: remainingBookings, error: remainingError } = await supabase
                .from('custom_bookings')
                .select('*')
                .eq('custom_tripId', booking.custom_tripId);
            if (remainingError) throw remainingError;
            
            remainingPassengerCount = remainingBookings.length;
            wasLastBooking = remainingBookings.length === 0;
            
            if (wasLastBooking) {
                // Delete the trip entirely
                await supabase
                    .from('custom_trips')
                    .delete()
                    .eq('id', booking.custom_tripId);
                
                eventEmitter.emit('update', {
                    type: 'custom-trip-deleted',
                    tripId: booking.custom_tripId,
                    bookingId: id
                });
            } else {
                // Just update the booking count
                eventEmitter.emit('update', {
                    type: 'custom-booking-deleted',
                    tripId: booking.custom_tripId,
                    bookingId: id,
                    remainingPassengerCount,
    passengerName: booking.name // Include the passenger name being removed

                });
            }
        } else {
            // Delete regular booking
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .select('*')
                .eq('id', id)
                .eq('email', user.email)
                .single();
            if (bookingError || !booking) {
                return res.status(404).json({ error: 'Booking not found or unauthorized' });
            }
            
            tripId = booking.tripId;
            
            const { error: deleteError } = await supabase
                .from('bookings')
                .delete()
                .eq('id', id);
            if (deleteError) throw deleteError;
            
            // Check remaining bookings for this trip
            const { data: remainingBookings, error: remainingError } = await supabase
                .from('bookings')
                .select('*')
                .eq('tripId', booking.tripId);
            if (remainingError) throw remainingError;
            
            remainingPassengerCount = remainingBookings.length;
            wasLastBooking = remainingBookings.length === 0;
            
            if (wasLastBooking) {
                // Delete the trip entirely
                await supabase
                    .from('trips')
                    .delete()
                    .eq('id', booking.tripId);
                
                eventEmitter.emit('update', {
                    type: 'trip-deleted',
                    tripId: booking.tripId,
                    bookingId: id
                });
            } else {
                // Just update the booking count
                eventEmitter.emit('update', {
                    type: 'booking-deleted',
                    tripId: booking.tripId,
                    bookingId: id,
                    remainingPassengerCount
                });
            }
        }
        
        res.json({ 
            success: true, 
            wasLastBooking,
            remainingPassengerCount 
        });
    } catch (error) {
        console.error('Error deleting booking:', error);
        res.status(500).json({ error: 'Failed to delete booking' });
    }
});

app.post('/release-van/:tripId', async (req, res) => {
    const { tripId } = req.params;
    
    try {
        const db = await loadDatabase();
        
        // Check if this is a custom trip
        const isCustomTrip = db.custom_trips.some(t => t.id === tripId);
        const trip = isCustomTrip 
            ? db.custom_trips.find(t => t.id === tripId)
            : db.trips.find(t => t.id === tripId);
        
        if (!trip) {
            return res.status(404).json({ error: 'لم يتم العثور على الرحلة، من فضلك حدث الصفحة لترى آخر التحديثات' });
        }
        
        // Release the van
        const { error } = await supabase
            .from(isCustomTrip ? 'custom_trips' : 'trips')
            .update({ vanId: null })
            .eq('id', tripId);

        if (error) throw error;
        
        // Emit SSE event
        eventEmitter.emit('update', {
            type: 'van-released',
            tripId: tripId,
            isCustom: isCustomTrip
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error releasing van:', error);
        res.status(500).json({ error: 'Failed to release van' });
    }
});

app.post('/reopen-trip/:tripId', async (req, res) => {
    const { tripId } = req.params;
    
    try {
        const db = await loadDatabase();
        
        // Check if this is a custom trip
        const isCustomTrip = db.custom_trips.some(t => t.id === tripId);
        const trip = isCustomTrip 
            ? db.custom_trips.find(t => t.id === tripId)
            : db.trips.find(t => t.id === tripId);
        
        if (!trip) {
            return res.status(404).json({ error: 'لم يتم العثور على الرحلة، من فضلك حدث الصفحة لترى آخر التحديثات' });
        }

        // Update the trip
        const { error } = await supabase
            .from(isCustomTrip ? 'custom_trips' : 'trips')
            .update({ isClosed: false })
            .eq('id', tripId);

        if (error) throw error;

        // Emit SSE event
        eventEmitter.emit('update', {
            type: 'trip-reopened',
            tripId: tripId,
            isCustom: isCustomTrip
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error reopening trip:', error);
        res.status(500).json({ error: 'Failed to reopen trip' });
    }
});

app.get('/check-trip', async (req, res) => {
    const { destination, date, isReturn } = req.query;
    const isReturnTrip = isReturn === 'true';
    
    try {
        const db = await loadDatabase();
        
        // Find all trips to the same destination on the same date and type
        const existingTrips = db.trips.filter(trip => 
            trip.destination === destination && 
            (isReturnTrip ? trip.returnDate === date : trip.goDate === date) &&
            trip.isReturnTrip === isReturnTrip &&
            !trip.isCompleted &&
            !trip.isClosed
        );

        if (existingTrips.length > 0) {
            // Check all trips for available capacity
            const availableTrips = [];
            
            for (const trip of existingTrips) {
                const { data: tripBookings, error: bookingsError } = await supabase
                    .from('bookings')
                    .select('*')
                    .eq('tripId', trip.id);

                if (bookingsError) throw bookingsError;

                const availableSeats = 8 - tripBookings.length;
                
                if (availableSeats > 0) {
                    availableTrips.push({
                        trip,
                        availableSeats,
                        project: db.projects.find(p => p.id === trip.projectId)
                    });
                }
            }

            if (availableTrips.length > 0) {
                // Sort by available seats (most available first)
                availableTrips.sort((a, b) => b.availableSeats - a.availableSeats);
                const bestOption = availableTrips[0];
                
                res.json({
                    hasExistingTrip: true,
                    tripId: bestOption.trip.id,
                    currentTime: isReturnTrip ? bestOption.trip.returnTime : bestOption.trip.goTime,
                    projectId: bestOption.trip.projectId,
                    projectName: bestOption.project ? bestOption.project.name : 'Unknown',
                    remainingCapacity: bestOption.availableSeats,
                    isFull: false,
                    canSetOwnTime: true,
                    timeType: isReturnTrip ? 'return' : 'departure'
                });
            } else {
                // All trips are full
                res.json({ 
                    hasExistingTrip: true,
                    isFull: true,
                    message: `All current trips to ${destination} on ${date} are full. You can create a new trip.`
                });
            }
        } else {
            // No existing trips
            res.json({ 
                hasExistingTrip: false
            });
        }
    } catch (error) {
        console.error('Error checking trip:', error);
        res.status(500).json({ error: 'Failed to check trip availability' });
    }
});

app.get('/check-custom-trip', async (req, res) => {
    const { destination, goDate, returnDate } = req.query;
    
    try {
        const db = await loadDatabase();
        
        console.log('Checking custom trips for:', { destination, goDate, returnDate });
        
        // Find existing custom trips to the same destination on the same dates
        const { data: existingDepartureTrips, error: depError } = await supabase
            .from('custom_trips')
            .select('*')
            .eq('destination', destination)
            .eq('goDate', goDate)
            .eq('isReturnTrip', false)
            .eq('isCompleted', false)
            .eq('isClosed', false);

        if (depError) throw depError;
        
        const { data: existingReturnTrips, error: retError } = await supabase
            .from('custom_trips')
            .select('*')
            .eq('destination', destination)
            .eq('returnDate', returnDate)
            .eq('isReturnTrip', true)
            .eq('isCompleted', false)
            .eq('isClosed', false);

        if (retError) throw retError;
        
        console.log('Found departure trips:', existingDepartureTrips.length);
        console.log('Found return trips:', existingReturnTrips.length);
        
        // Check availability for each trip type
        let departureTrip = null;
        let returnTrip = null;
        
        if (existingDepartureTrips.length > 0) {
            for (const trip of existingDepartureTrips) {
                const { data: bookings, error: bookingsError } = await supabase
                    .from('custom_bookings')
                    .select('*')
                    .eq('custom_tripId', trip.id);

                if (bookingsError) throw bookingsError;

                if (bookings.length < 8) {
                    departureTrip = {
                        id: trip.id,
                        goDate: trip.goDate,
                        goTime: trip.goTime,
                        availableSeats: 8 - bookings.length
                    };
                    break;
                }
            }
        }
        
        if (existingReturnTrips.length > 0) {
            for (const trip of existingReturnTrips) {
                const { data: bookings, error: bookingsError } = await supabase
                    .from('custom_bookings')
                    .select('*')
                    .eq('custom_tripId', trip.id);

                if (bookingsError) throw bookingsError;

                if (bookings.length < 8) {
                    returnTrip = {
                        id: trip.id,
                        returnDate: trip.returnDate,
                        returnTime: trip.returnTime,
                        availableSeats: 8 - bookings.length
                    };
                    break;
                }
            }
        }
        
        const hasExistingTrips = departureTrip !== null || returnTrip !== null;
        
        console.log('Response:', { hasExistingTrips, departureTrip, returnTrip });
        
        res.json({
            hasExistingTrips,
            departureTrip,
            returnTrip
        });
    } catch (error) {
        console.error('Error checking custom trip:', error);
        res.status(500).json({ error: 'Failed to check custom trip availability' });
    }
});

app.post('/book', checkBookingTime, async (req, res) => {
    try {
        // Get authenticated user
        const token = req.headers.authorization?.split(' ')[1] || req.cookies['sb-access-token'];
        if (!token) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }

        const displayName = user.user_metadata?.display_name || user.email.split('@')[0];
        const { projectId, destination, goDate, returnDate, goTime, returnTime } = req.body;

        // Validate dates
        if (new Date(returnDate) < new Date(goDate)) {
            return res.status(400).json({ error: 'Return date cannot be before departure date' });
        }

        // Validate same-day times
        if (goDate === returnDate && returnTime <= goTime) {
            return res.status(400).json({ error: 'Return time must be after departure time for same-day trips' });
        }

        // Find the project
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('*')
            .eq('id', projectId)
            .single();

        if (projectError || !project) {
            return res.status(400).json({ error: 'Invalid project' });
        }

        // Check remaining trips
        if (project.number_of_remaining_trips <= 0) {
            return res.status(400).json({ error: 'No remaining trips for this project' });
        }

        // Function to find or create trip with dynamic time handling
        const findOrCreateTrip = async (isReturnTrip, date, requestedTime) => {
            // Check for existing trips to join
            const { data: existingTrips, error: tripsError } = await supabase
                .from('trips')
                .select('*')
                .eq('destination', destination)
                .eq(isReturnTrip ? 'returnDate' : 'goDate', date)
                .eq('isReturnTrip', isReturnTrip)
                .eq('projectId', projectId)
                .eq('isCompleted', false)
                .eq('isClosed', false);

            if (tripsError) throw tripsError;

            // Check for available capacity in existing trips
            for (const trip of existingTrips) {
                const { data: tripBookings, error: bookingsError } = await supabase
                    .from('bookings')
                    .select('*')
                    .eq('tripId', trip.id);

                if (bookingsError) throw bookingsError;
                
                if (tripBookings.length < 8) {
                    // Update trip time based on the new logic
                    const currentTime = isReturnTrip ? trip.returnTime : trip.goTime;
                    let updatedTime = currentTime;
                    let timeUpdated = false;

                    if (isReturnTrip) {
                        // For return trips, use the LATEST time
                        if (requestedTime > currentTime) {
                            updatedTime = requestedTime;
                            timeUpdated = true;
                            
                            // Update the trip in database
                            const { error: updateError } = await supabase
                                .from('trips')
                                .update({ returnTime: updatedTime })
                                .eq('id', trip.id);

                            if (updateError) throw updateError;
                        }
                    } else {
                        // For departure trips, use the EARLIEST time
                        if (requestedTime < currentTime) {
                            updatedTime = requestedTime;
                            timeUpdated = true;
                            
                            // Update the trip in database
                            const { error: updateError } = await supabase
                                .from('trips')
                                .update({ goTime: updatedTime })
                                .eq('id', trip.id);

                            if (updateError) throw updateError;
                        }
                    }

                    return { 
                        tripId: trip.id, 
                        isNew: false, 
                        timeUpdated, 
                        newTime: updatedTime,
                        oldTime: currentTime
                    };
                }
            }

            // No available capacity in existing trips - create new trip
            const newTripId = uuidv4();
            const newTrip = {
                id: newTripId,
                projectId: projectId,
                destination,
                vanId: null,
                goDate: isReturnTrip ? goDate : date,
                returnDate: isReturnTrip ? date : returnDate,
                goTime: isReturnTrip ? goTime : requestedTime,
                returnTime: isReturnTrip ? requestedTime : returnTime,
                isReturnTrip,
                isCompleted: false,
                isClosed: false,
                createdAt: new Date().toISOString()
            };

            const { error: insertError } = await supabase
                .from('trips')
                .insert(newTrip);

            if (insertError) throw insertError;

            return { tripId: newTripId, isNew: true, timeUpdated: false };
        };

        // Create or find departure trip
        const departureResult = await findOrCreateTrip(false, goDate, goTime);
        if (departureResult.error) {
            return res.status(400).json({ error: departureResult.error });
        }

        // Create or find return trip
        const returnResult = await findOrCreateTrip(true, returnDate, returnTime);
        if (returnResult.error) {
            return res.status(400).json({ error: returnResult.error });
        }

        // Create bookings using user's display name
        const departureBooking = {
            id: uuidv4(),
            name: displayName,
            email: user.email,
            tripId: departureResult.tripId,
            createdAt: new Date().toISOString()
        };

        const returnBooking = {
            id: uuidv4(),
            name: displayName,
            email: user.email,
            tripId: returnResult.tripId,
            createdAt: new Date().toISOString()
        };

        // Insert bookings
        const { error: bookingsError } = await supabase
            .from('bookings')
            .insert([departureBooking, returnBooking]);

        if (bookingsError) throw bookingsError;

        // Emit SSE events for new trips
        if (departureResult.isNew) {
            const { data: trip, error: tripError } = await supabase
                .from('trips')
                .select('*')
                .eq('id', departureResult.tripId)
                .single();

            if (!tripError && trip) {
                eventEmitter.emit('update', {
                    type: 'new-trip',
                    trip: enrichTripData(trip, await loadDatabase())
                });
            }
        }

        if (returnResult.isNew) {
            const { data: trip, error: tripError } = await supabase
                .from('trips')
                .select('*')
                .eq('id', returnResult.tripId)
                .single();

            if (!tripError && trip) {
                eventEmitter.emit('update', {
                    type: 'new-trip',
                    trip: enrichTripData(trip, await loadDatabase())
                });
            }
        }

        // Emit time update events if times were changed
        if (departureResult.timeUpdated) {
            eventEmitter.emit('update', {
                type: 'trip-time-updated',
                tripId: departureResult.tripId,
                isReturnTrip: false,
                newTime: departureResult.newTime,
                oldTime: departureResult.oldTime,
                updatedBy: displayName
            });
        }

        if (returnResult.timeUpdated) {
            eventEmitter.emit('update', {
                type: 'trip-time-updated',
                tripId: returnResult.tripId,
                isReturnTrip: true,
                newTime: returnResult.newTime,
                oldTime: returnResult.oldTime,
                updatedBy: displayName
            });
        }

        // Emit booking events
        eventEmitter.emit('update', {
            type: 'booking-added',
            bookings: [departureResult.tripId, returnResult.tripId]
        });

        res.json({
            success: true,
            bookings: [
                { 
                    tripId: departureResult.tripId, 
                    isReturnTrip: false, 
                    isNew: departureResult.isNew,
                    timeUpdated: departureResult.timeUpdated,
                    newTime: departureResult.newTime
                },
                { 
                    tripId: returnResult.tripId, 
                    isReturnTrip: true, 
                    isNew: returnResult.isNew,
                    timeUpdated: returnResult.timeUpdated,
                    newTime: returnResult.newTime
                }
            ],
            remainingTrips: project.number_of_remaining_trips
        });

    } catch (error) {
        console.error('Error booking trip:', error);
        res.status(500).json({ error: 'Failed to book trip' });
    }
});
// Destination management endpoints
app.get('/destinations', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('destinations')
            .select('*');

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Error fetching destinations:', error);
        res.status(500).json({ error: 'Failed to fetch destinations' });
    }
});

app.post('/add-destination', async (req, res) => {
    const { name } = req.body;
    
    try {
        // Validate input
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Destination name is required' });
        }
        
        // Check if destination already exists
        const { data: existingDestinations, error: checkError } = await supabase
            .from('destinations')
            .select('*')
            .eq('name', name.trim());

        if (checkError) throw checkError;
        
        if (existingDestinations.length > 0) {
            return res.status(400).json({ error: 'Destination already exists' });
        }
        
        const newDestination = {
            id: uuidv4(),
            name: name.trim()
        };
        
        const { error: insertError } = await supabase
            .from('destinations')
            .insert(newDestination);

        if (insertError) throw insertError;
        
        // Emit SSE event
        eventEmitter.emit('update', {
            type: 'destination-added',
            destination: newDestination
        });
        
        res.json({ success: true, destination: newDestination });
    } catch (error) {
        console.error('Error adding destination:', error);
        res.status(500).json({ error: 'Failed to add destination' });
    }
});

app.post('/edit-destination/:id', async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    
    try {
        // Validate input
        if (!name || name.trim() === '') {
            return res.status(400).json({ error: 'Destination name is required' });
        }
        
        // Check if destination exists
        const { data: destination, error: destError } = await supabase
            .from('destinations')
            .select('*')
            .eq('id', id)
            .single();

        if (destError) throw destError;
        if (!destination) {
            return res.status(404).json({ error: 'Destination not found' });
        }
        
        // Check if new name already exists (excluding current destination)
        const { data: existingDestinations, error: checkError } = await supabase
            .from('destinations')
            .select('*')
            .eq('name', name.trim())
            .neq('id', id);

        if (checkError) throw checkError;
        
        if (existingDestinations.length > 0) {
            return res.status(400).json({ error: 'Destination with this name already exists' });
        }
        
        const oldName = destination.name;
        const updateData = { name: name.trim() };
        
        const { error: updateError } = await supabase
            .from('destinations')
            .update(updateData)
            .eq('id', id);

        if (updateError) throw updateError;
        
        // Emit SSE event
        eventEmitter.emit('update', {
            type: 'destination-updated',
            destinationId: id,
            oldName,
            newName: updateData.name
        });
        
        res.json({ success: true, destination: { ...destination, ...updateData } });
    } catch (error) {
        console.error('Error updating destination:', error);
        res.status(500).json({ error: 'Failed to update destination' });
    }
});

app.post('/delete-destination/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Check if destination is in use by projects
        const { data: projectsUsing, error: projectsError } = await supabase
            .from('projects')
            .select('*')
            .eq('locationId', id);

        if (projectsError) throw projectsError;
        
        if (projectsUsing.length > 0) {
            return res.status(400).json({ 
                error: 'Cannot delete destination used by projects',
                projects: projectsUsing.map(p => p.name)
            });
        }
        
        // Check if destination is in use by trips
        const { data: destination, error: destError } = await supabase
            .from('destinations')
            .select('*')
            .eq('id', id)
            .single();

        if (destError) throw destError;
        
        if (destination) {
            const { data: tripsUsing, error: tripsError } = await supabase
                .from('trips')
                .select('*')
                .eq('destination', destination.name);

            if (tripsError) throw tripsError;
            
            if (tripsUsing.length > 0) {
                return res.status(400).json({ 
                    error: 'Cannot delete destination used by trips',
                    tripCount: tripsUsing.length
                });
            }
        }
        
        // Delete the destination
        const { error: deleteError } = await supabase
            .from('destinations')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;
        
        // Emit SSE event
        eventEmitter.emit('update', {
            type: 'destination-deleted',
            destinationId: id,
            destinationName: destination?.name || 'Unknown'
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting destination:', error);
        res.status(500).json({ error: 'Failed to delete destination' });
    }
});

app.post('/enroll-trip/:tripId', checkBookingTime, async (req, res) => {
    const { tripId } = req.params;
    const { preferredTime } = req.body; // Get the user's preferred time
    
    try {
        // Get authenticated user
        const token = req.headers.authorization?.split(' ')[1] || req.cookies['sb-access-token'];
        if (!token) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }
        
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return res.status(401).json({ error: 'حدث الصفحة من فضلك' });
        }
        
        const displayName = user.user_metadata?.display_name || user.email.split('@')[0];

        // Check if this is a custom trip
        const { data: customTripCheck, error: customCheckError } = await supabase
            .from('custom_trips')
            .select('id')
            .eq('id', tripId)
            .single();
            
        if (!customCheckError && customTripCheck) {
            return res.status(400).json({ error: 'Use the custom trip enrollment endpoint for this trip' });
        }

        // Get the trip
        const { data: trip, error: tripError } = await supabase
            .from('trips')
            .select('*')
            .eq('id', tripId)
            .single();
            
        if (tripError || !trip) {
            return res.status(404).json({ error: 'لم يتم العثور على الرحلة، من فضلك حدث الصفحة لترى آخر التحديثات' });
        }
        
        if (trip.isCompleted) {
            return res.status(400).json({ error: 'Cannot enroll in a completed trip' });
        }
        
        if (trip.isClosed) {
            return res.status(400).json({ error: 'Cannot enroll in a closed trip' });
        }

        // Check capacity
        const { data: tripBookings, error: bookingsError } = await supabase
            .from('bookings')
            .select('*')
            .eq('tripId', trip.id);
            
        if (bookingsError) throw bookingsError;
        
        if (tripBookings.length >= 8) {
            return res.status(400).json({ error: 'This trip is already full' });
        }

        // Handle time update logic if preferredTime is provided
        let timeUpdated = false;
        let newTime = null;
        
        if (preferredTime) {
            const currentTime = trip.isReturnTrip ? trip.returnTime : trip.goTime;
            let shouldUpdateTime = false;
            
            if (trip.isReturnTrip) {
                // For return trips: update if preferred time is later than current time
                shouldUpdateTime = preferredTime > currentTime;
            } else {
                // For departure trips: update if preferred time is earlier than current time
                shouldUpdateTime = preferredTime < currentTime;
            }
            
            if (shouldUpdateTime) {
                const updateField = trip.isReturnTrip ? 'returnTime' : 'goTime';
                
                const { error: updateError } = await supabase
                    .from('trips')
                    .update({ [updateField]: preferredTime })
                    .eq('id', tripId);
                    
                if (updateError) {
                    console.error('Error updating trip time:', updateError);
                    // Continue with enrollment even if time update fails
                } else {
                    timeUpdated = true;
                    newTime = preferredTime;
                    
                    // Emit SSE event for time update
                    eventEmitter.emit('update', {
                        type: 'trip-time-updated',
                        tripId: tripId,
                        isReturnTrip: trip.isReturnTrip,
                        newTime: preferredTime,
                        oldTime: currentTime,
                        updatedBy: displayName
                    });
                }
            }
        }

        // Create booking with user's display name
        const newBooking = {
            id: uuidv4(),
            name: displayName,
            email: user.email,
            tripId: trip.id,
            createdAt: new Date().toISOString()
        };

        const { error: insertError } = await supabase
            .from('bookings')
            .insert(newBooking);
            
        if (insertError) throw insertError;

        // Emit SSE event with the passenger addition
        eventEmitter.emit('update', {
            type: 'passenger-added',
            tripId: tripId,
            passengerName: displayName,
            passengerCount: tripBookings.length + 1
        });

        res.json({ 
            success: true, 
            booking: newBooking,
            timeUpdated: timeUpdated,
            newTime: newTime,
            isReturnTrip: trip.isReturnTrip // Include trip type in response
        });
        
    } catch (error) {
        console.error('Error enrolling in trip:', error);
        res.status(500).json({ error: 'Failed to enroll in trip' });
    }
});app.get('/bookings/:date', async (req, res) => {
    const date = req.params.date;
    const excludeCompleted = req.query.excludeCompleted === 'true';
    
    try {
        const db = await loadDatabase();
        
        // FIXED: Only return regular trips, not custom trips
        let tripsOnDate = db.trips.filter(trip => 
            ((trip.goDate === date && !trip.isReturnTrip) || 
            (trip.returnDate === date && trip.isReturnTrip))
        );
        
        // Filter out completed trips if requested
        if (excludeCompleted) {
            tripsOnDate = tripsOnDate.filter(trip => !trip.isCompleted);
        }
        
        const enrichedTrips = tripsOnDate.map(trip => {
            const project = db.projects.find(p => p.id === trip.projectId);
            const van = trip.vanId ? db.vans.find(v => v.id === trip.vanId) : null;
            const bookings = db.bookings.filter(b => b.tripId === trip.id);
            
            return {
                tripId: trip.id,
                vanId: trip.vanId,
                driver: van ? van.driver : 'Not assigned',
                destination: trip.destination,
                projectName: project ? project.name : 'Unknown',
                date: trip.isReturnTrip ? trip.returnDate : trip.goDate,
                time: trip.isReturnTrip ? trip.returnTime : trip.goTime,
                isReturnTrip: trip.isReturnTrip,
                passengers: bookings.map(b => ({ name: b.name, email: b.email })),
                passengerCount: bookings.length,
                canComplete: bookings.length >= 8 && !trip.isCompleted && trip.vanId !== null,
                isCompleted: trip.isCompleted,
                needsVan: trip.vanId === null,
                isClosed: trip.isClosed || false,
                isCustom: false
            };
        });
        
        res.json(enrichedTrips);
    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
});

app.get('/projects', requireAdmin, async (req, res) => {
    try {
        const db = await loadDatabase();
        res.render('projects', {
            projects: db.projects,
            vans: db.vans,
            destinations: db.destinations
        });
    } catch (error) {
        console.error('Error loading projects view:', error);
        res.status(500).render('error', { message: 'Failed to load projects view' });
    }
});

app.post('/complete-trip/:tripId', async (req, res) => {
    const { tripId } = req.params;
    const { shouldDecrement } = req.body;
    
    // Server-side protection against duplicate requests
    if (completionInProgress.has(tripId)) {
        return res.status(429).json({ 
            error: 'Trip completion already in progress. Please wait.' 
        });
    }
    
    // Add to in-progress set
    completionInProgress.add(tripId);
    
    try {
        const db = await loadDatabase();
        
        // Check if this is a custom trip
        const isCustomTrip = db.custom_trips.some(t => t.id === tripId);
        const trip = isCustomTrip 
            ? db.custom_trips.find(t => t.id === tripId)
            : db.trips.find(t => t.id === tripId);
        
        if (!trip) {
            completionInProgress.delete(tripId);
            return res.status(404).json({ error: 'لم يتم العثور على الرحلة، من فضلك حدث الصفحة لترى آخر التحديثات' });
        }

        // Check if trip is already completed
        if (trip.isCompleted) {
            completionInProgress.delete(tripId);
            return res.status(400).json({ error: 'Trip is already completed' });
        }

        // Mark trip as completed
        const { error: tripUpdateError } = await supabase
            .from(isCustomTrip ? 'custom_trips' : 'trips')
            .update({ isCompleted: true })
            .eq('id', tripId);

        if (tripUpdateError) throw tripUpdateError;

        // FIXED: Handle project trip decrementing properly for custom trips
        if (!isCustomTrip) {
            // Regular trip logic
            const project = db.projects.find(p => p.id === trip.projectId);
            if (!project) {
                completionInProgress.delete(tripId);
                return res.status(404).json({ error: 'Project not found' });
            }

            if (shouldDecrement && project.number_of_remaining_trips <= 0) {
                completionInProgress.delete(tripId);
                return res.status(400).json({ 
                    error: `Cannot complete trip. Project "${project.name}" has no remaining trips available.` 
                });
            }

            if (shouldDecrement !== false && project.number_of_remaining_trips <= 0) {
                completionInProgress.delete(tripId);
                return res.status(400).json({ 
                    error: `Cannot complete trip. Project "${project.name}" has no remaining trips available.` 
                });
            }

            // Decrement remaining trips if needed (only for regular trips)
            if (shouldDecrement || !trip.isReturnTrip) {
                const newRemainingTrips = Math.max(0, project.number_of_remaining_trips - 1);
                
                const { error: projectUpdateError } = await supabase
                    .from('projects')
                    .update({ number_of_remaining_trips: newRemainingTrips })
                    .eq('id', project.id);

                if (projectUpdateError) throw projectUpdateError;
            }
            
            completionInProgress.delete(tripId);

            // Emit SSE event
eventEmitter.emit('update', {
    type: 'trip-completed',
    tripId: tripId,
    remainingTrips: project.number_of_remaining_trips,
    projectId: project.id,
    projectName: project.name,
    isCustom: false
});

            res.json({
                success: true,
                remainingTrips: project.number_of_remaining_trips,
                projectId: project.id
            });
        } else {
            // FIXED: Custom trip completion logic with project decrementing
            const project = db.projects.find(p => p.id === trip.projectId);
            if (!project) {
                completionInProgress.delete(tripId);
                return res.status(404).json({ error: 'Project not found for custom trip' });
            }

            // FIXED: For custom trips, always decrement if shouldDecrement is true or undefined
            if (shouldDecrement !== false) {
                if (project.number_of_remaining_trips <= 0) {
                    completionInProgress.delete(tripId);
                    return res.status(400).json({ 
                        error: `Cannot complete custom trip. Project "${project.name}" has no remaining trips available.` 
                    });
                }
                
                // Decrement the project's remaining trips
                const newRemainingTrips = Math.max(0, project.number_of_remaining_trips - 1);
                
                const { error: projectUpdateError } = await supabase
                    .from('projects')
                    .update({ number_of_remaining_trips: newRemainingTrips })
                    .eq('id', project.id);

                if (projectUpdateError) throw projectUpdateError;
            }

            completionInProgress.delete(tripId);

            // Emit SSE event for custom trip completion
            eventEmitter.emit('update', {
                type: 'custom-trip-completed',
                tripId: tripId,
                remainingTrips: project.number_of_remaining_trips,
                projectId: project.id,
                isCustom: true
            });

            res.json({
                success: true,
                message: 'Custom trip completed successfully',
                remainingTrips: project.number_of_remaining_trips,
                projectId: project.id
            });
        }
    } catch (error) {
        // Make sure to clean up on any error
        completionInProgress.delete(tripId);
        console.error('Complete trip error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Project management endpoints
app.post('/add-project', async (req, res) => {
    const { name, number_of_remaining_trips, locationId } = req.body;
    
    try {
        const initial_trips = number_of_remaining_trips || 50;
        
        const { data, error } = await supabase
            .from('projects')
            .insert({
                name,
                locationId: locationId || null,
                initial_trips,
                number_of_remaining_trips: initial_trips
            })
            .select();
        
        if (error) throw error;
        
        eventEmitter.emit('update', {
            type: 'project-added',
            project: data[0]
        });
        
        res.json({ success: true, project: data[0] });
    } catch (error) {
        console.error('Error adding project:', error);
        res.status(500).json({ error: error.message || 'Failed to add project' });
    }
});
app.post('/delete-project/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Check if any vans are assigned to this project
        const { data: vansUsingProject, error: vansError } = await supabase
            .from('vans')
            .select('*')
            .eq('projectId', id);

        if (vansError) throw vansError;
        
        if (vansUsingProject.length > 0) {
            return res.status(400).json({ error: 'Cannot delete project with assigned vans' });
        }
        
        // Check if any trips are using this project
        const { data: tripsUsingProject, error: tripsError } = await supabase
            .from('trips')
            .select('*')
            .eq('projectId', id);

        if (tripsError) throw tripsError;
        
        if (tripsUsingProject.length > 0) {
            return res.status(400).json({ error: 'Cannot delete project with scheduled trips' });
        }
        
        // Delete the project
        const { error: deleteError } = await supabase
            .from('projects')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;
        
        eventEmitter.emit('update', {
            type: 'project-deleted',
            projectId: id
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// Van management endpoints
app.post('/add-van', async (req, res) => {
    const { driver, projectId } = req.body;
    
    try {
        // Validate project exists
        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('*')
            .eq('id', projectId)
            .single();

        if (projectError) throw projectError;
        if (!project) {
            return res.status(400).json({ error: 'Invalid project' });
        }
        
        const newVan = {
            id: uuidv4(),
            driver,
            capacity: 8,
            projectId: projectId
        };
        
        const { error } = await supabase
            .from('vans')
            .insert(newVan);

        if (error) throw error;
        
        eventEmitter.emit('update', {
            type: 'van-added',
            van: newVan
        });
        
        res.json({ success: true, van: newVan });
    } catch (error) {
        console.error('Error adding van:', error);
        res.status(500).json({ error: 'Failed to add van' });
    }
});

app.post('/delete-van/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        // Check if van is assigned to any trips
        const { data: vanInUse, error: tripsError } = await supabase
            .from('trips')
            .select('*')
            .eq('vanId', id);

        if (tripsError) throw tripsError;
        
        if (vanInUse.length > 0) {
            return res.status(400).json({ error: 'Cannot delete van assigned to trips' });
        }
        
        // Delete the van
        const { error: deleteError } = await supabase
            .from('vans')
            .delete()
            .eq('id', id);

        if (deleteError) throw deleteError;
        
        eventEmitter.emit('update', {
            type: 'van-deleted',
            vanId: id
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting van:', error);
        res.status(500).json({ error: 'Failed to delete van' });
    }
});

app.post('/export-completed-trips', async (req, res) => {
    const { format, keepData = false } = req.body;
    
    try {
        // Add better error handling for database loading
        let db;
        try {
            db = await loadDatabase();
            console.log('Database loaded successfully:', {
                tripsCount: db.trips?.length || 0,
                customTripsCount: db.custom_trips?.length || 0
            });
        } catch (dbError) {
            console.error('Database loading failed:', dbError);
            return res.status(500).json({ error: 'Failed to load database. Please try again.' });
        }
        
        // Ensure we have valid data structures
        if (!db.trips || !db.custom_trips) {
            console.error('Invalid database structure:', db);
            return res.status(500).json({ error: 'Invalid database structure' });
        }
        
        // Get completed regular trips with better error handling
        const completedRegularTrips = db.trips
            .filter(trip => trip && trip.isCompleted)
            .map(trip => {
                try {
                    return enrichTripData(trip, db);
                } catch (enrichError) {
                    console.error('Error enriching trip:', trip.id, enrichError);
                    return null;
                }
            })
            .filter(trip => trip !== null);

        // Get completed custom trips with better error handling
        const completedCustomTrips = db.custom_trips
            .filter(trip => trip && trip.isCompleted)
            .map(trip => {
                try {
                    return enrichCustomTripData(trip, db);
                } catch (enrichError) {
                    console.error('Error enriching custom trip:', trip.id, enrichError);
                    return null;
                }
            })
            .filter(trip => trip !== null);

        // Combine both types
        const completedTrips = [...completedRegularTrips, ...completedCustomTrips];
        
        console.log(`Found ${completedTrips.length} completed trips (${completedRegularTrips.length} regular, ${completedCustomTrips.length} custom)`);
        
        if (completedTrips.length === 0) {
            return res.status(400).json({ error: 'No completed trips to export' });
        }

        if (format === 'pdf') {
            try {
                const { jsPDF } = require('jspdf');
                require('jspdf-autotable');
                
                const doc = new jsPDF('landscape');
                
                // PDF Header
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(18);
                doc.text('Completed Trips Report', 14, 20);
                
                const now = new Date();
                const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                const formattedTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
                
                doc.setFontSize(12);
                doc.text(`Generated on: ${formattedDate} ${formattedTime}`, 14, 30);

                // Prepare table data
                const tableData = completedTrips.map(trip => {
                    const passengerNames = (trip.bookings || []).map(booking => booking.name || 'Unknown').join(', ');
                    return [
                        trip.id || 'N/A',
                        trip.projectName || 'Unknown',
                        trip.destination || 'Unknown',
                        trip.isReturnTrip ? 'Return' : 'Departure',
                        trip.isReturnTrip ? (trip.returnDate || 'N/A') : (trip.goDate || 'N/A'),
                        trip.isReturnTrip ? (trip.returnTime || 'N/A') : (trip.goTime || 'N/A'),
                        trip.van ? (trip.van.driver || 'Unknown') : 'Not assigned',
                        (trip.bookings || []).length,
                        passengerNames || 'No passengers'
                    ];
                });
                
                // Add table with row coloring
                doc.autoTable({
                    head: [['ID', 'Project', 'Destination', 'Type', 'Date', 'Time', 'Driver', 'Count', 'Passenger Names']],
                    body: tableData,
                    startY: 40,
                    styles: {
                        fontSize: 8,
                        cellPadding: 2,
                        overflow: 'linebreak',
                        cellWidth: 'wrap'
                    },
                    headStyles: {
                        fillColor: [67, 97, 238],
                        textColor: 255
                    },
                    columnStyles: {
                        8: { cellWidth: 60 }
                    },
                    didParseCell: function(data) {
                        if (data.section === 'body') {
                            const rowIndex = data.row.index;
                            const trip = completedTrips[rowIndex];
                            
                            if (trip && trip.isReturnTrip) {
                                data.cell.styles.fillColor = [254, 242, 242];
                            } else {
                                data.cell.styles.fillColor = [239, 246, 255];
                            }
                        }
                    }
                });
                
                // Delete data unless keepData is true
                if (!keepData) {
                    await deleteCompletedTripsData(completedRegularTrips, completedCustomTrips);
                }
                
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'attachment; filename=completed-trips.pdf');
                res.send(Buffer.from(doc.output('arraybuffer')));
                
            } catch (error) {
                console.error('PDF generation error:', error);
                return res.status(500).json({ error: 'Failed to generate PDF' });
            }
        } else if (format === 'excel') {
            try {
                const XLSX = require('xlsx');
                const wb = XLSX.utils.book_new();
                
                // Prepare trips data with better error handling
                const tripsData = completedTrips.map((trip, index) => {
                    const bookings = trip.bookings || [];
                    const passengerNames = bookings.map(booking => booking.name || 'Unknown').join(', ');
                    const passengerEmails = bookings.map(booking => booking.email || 'Unknown').join(', ');
                    
                    return {
                        ID: trip.id || 'N/A',
                        Project: trip.projectName || 'Unknown',
                        Destination: trip.destination || 'Unknown',
                        Type: trip.isReturnTrip ? 'Return' : 'Departure',
                        Date: trip.isReturnTrip ? (trip.returnDate || 'N/A') : (trip.goDate || 'N/A'),
                        Time: trip.isReturnTrip ? (trip.returnTime || 'N/A') : (trip.goTime || 'N/A'),
                        Driver: trip.van ? (trip.van.driver || 'Unknown') : 'Not assigned',
                        'Passenger Count': bookings.length,
                        'Passenger Names': passengerNames || 'No passengers',
                        'Passenger Emails': passengerEmails || 'No passengers'
                    };
                });
                
                const tripsWS = XLSX.utils.json_to_sheet(tripsData);
                
                // Auto-size columns with better error handling
                if (tripsWS['!ref']) {
                    try {
                        const range = XLSX.utils.decode_range(tripsWS['!ref']);
                        const colWidths = [];
                        for (let C = range.s.c; C <= range.e.c; ++C) {
                            let maxWidth = 10;
                            for (let R = range.s.r; R <= range.e.r; ++R) {
                                const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                                const cell = tripsWS[cellAddress];
                                if (cell && cell.v) {
                                    const cellLength = cell.v.toString().length;
                                    maxWidth = Math.max(maxWidth, cellLength);
                                }
                            }
                            colWidths.push({ wch: Math.min(maxWidth + 2, 50) });
                        }
                        tripsWS['!cols'] = colWidths;
                    } catch (colError) {
                        console.warn('Could not auto-size columns:', colError);
                    }
                }
                
                // Apply conditional formatting with better error handling
                if (tripsWS['!ref']) {
                    try {
                        const range = XLSX.utils.decode_range(tripsWS['!ref']);
                        for (let R = 1; R <= range.e.r; R++) {
                            const tripIndex = R - 1;
                            const trip = completedTrips[tripIndex];
                            
                            if (trip) {
                                for (let C = range.s.c; C <= range.e.c; C++) {
                                    const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
                                    
                                    if (!tripsWS[cellRef]) {
                                        tripsWS[cellRef] = { t: 's', v: '' };
                                    }
                                    
                                    if (!tripsWS[cellRef].s) tripsWS[cellRef].s = {};
                                    
                                    tripsWS[cellRef].s.fill = {
                                        patternType: 'solid',
                                        fgColor: { 
                                            rgb: trip.isReturnTrip ? 'FFEBEE' : 'E3F2FD' 
                                        }
                                    };
                                    
                                    tripsWS[cellRef].s.font = {
                                        color: { 
                                            rgb: trip.isReturnTrip ? 'B71C1C' : '0D47A1' 
                                        }
                                    };
                                    
                                    tripsWS[cellRef].s.border = {
                                        top: { style: 'thin', color: { rgb: 'CCCCCC' } },
                                        bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
                                        left: { style: 'thin', color: { rgb: 'CCCCCC' } },
                                        right: { style: 'thin', color: { rgb: 'CCCCCC' } }
                                    };
                                }
                            }
                        }
                    } catch (formatError) {
                        console.warn('Could not apply formatting:', formatError);
                    }
                }
                
                XLSX.utils.book_append_sheet(wb, tripsWS, "Completed Trips");
                
                // Create passengers sheet
                const passengersData = [];
                completedTrips.forEach(trip => {
                    const bookings = trip.bookings || [];
                    bookings.forEach(booking => {
                        passengersData.push({
                            'Trip ID': trip.id || 'N/A',
                            'Project': trip.projectName || 'Unknown',
                            'Destination': trip.destination || 'Unknown',
                            'Type': trip.isReturnTrip ? 'Return' : 'Departure',
                            'Date': trip.isReturnTrip ? (trip.returnDate || 'N/A') : (trip.goDate || 'N/A'),
                            'Time': trip.isReturnTrip ? (trip.returnTime || 'N/A') : (trip.goTime || 'N/A'),
                            'Driver': trip.van ? (trip.van.driver || 'Unknown') : 'Not assigned',
                            'Passenger Name': booking.name || 'Unknown',
                            'Passenger Email': booking.email || 'Unknown'
                        });
                    });
                });
                
                if (passengersData.length > 0) {
                    const passengersWS = XLSX.utils.json_to_sheet(passengersData);
                    XLSX.utils.book_append_sheet(wb, passengersWS, "Passenger Details");
                }
                
                // Generate Excel file
                const excelBuffer = XLSX.write(wb, { 
                    bookType: 'xlsx', 
                    type: 'array',
                    cellStyles: true,
                    sheetStubs: false,
                    bookSST: false
                });
                
                // Delete data unless keepData is true
                if (!keepData) {
                    await deleteCompletedTripsData(completedRegularTrips, completedCustomTrips);
                }
                
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', 'attachment; filename=completed-trips.xlsx');
                res.send(Buffer.from(excelBuffer));
                
            } catch (error) {
                console.error('Excel generation error:', error);
                return res.status(500).json({ error: 'Failed to generate Excel file' });
            }
        } else {
            res.status(400).json({ error: 'Invalid format' });
        }
    } catch (error) {
        console.error('Error exporting completed trips:', error);
        res.status(500).json({ error: 'Failed to export completed trips' });
    }
});
async function deleteCompletedTripsData(completedRegularTrips, completedCustomTrips) {
    try {
        const completedRegularTripIds = completedRegularTrips.map(trip => trip.id).filter(id => id);
        const completedCustomTripIds = completedCustomTrips.map(trip => trip.id).filter(id => id);
        
        // Remove completed regular trips and their bookings
        if (completedRegularTripIds.length > 0) {
            const { error: deleteBookingsError } = await supabase
                .from('bookings')
                .delete()
                .in('tripId', completedRegularTripIds);
                
            if (deleteBookingsError) {
                console.error('Error deleting regular bookings:', deleteBookingsError);
                throw deleteBookingsError;
            }
            
            const { error: deleteTripsError } = await supabase
                .from('trips')
                .delete()
                .in('id', completedRegularTripIds);
                
            if (deleteTripsError) {
                console.error('Error deleting regular trips:', deleteTripsError);
                throw deleteTripsError;
            }
        }
        
        // Remove completed custom trips and their bookings
        if (completedCustomTripIds.length > 0) {
            const { error: deleteCustomBookingsError } = await supabase
                .from('custom_bookings')
                .delete()
                .in('custom_tripId', completedCustomTripIds);
                
            if (deleteCustomBookingsError) {
                console.error('Error deleting custom bookings:', deleteCustomBookingsError);
                throw deleteCustomBookingsError;
            }
            
            const { error: deleteCustomTripsError } = await supabase
                .from('custom_trips')
                .delete()
                .in('id', completedCustomTripIds);
                
            if (deleteCustomTripsError) {
                console.error('Error deleting custom trips:', deleteCustomTripsError);
                throw deleteCustomTripsError;
            }
        }
        
        console.log(`Successfully deleted ${completedRegularTripIds.length} regular trips and ${completedCustomTripIds.length} custom trips`);
    } catch (error) {
        console.error('Error deleting completed trips data:', error);
        throw error;
    }
}

// Debug endpoint to view database contents
app.get('/debug/database', async (req, res) => {
    try {
        const db = await loadDatabase();
        res.json(db);
    } catch (error) {
        console.error('Error loading database for debug:', error);
        res.status(500).json({ error: 'Failed to load database' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Debug database view: http://localhost:${PORT}/debug/database`);
});
