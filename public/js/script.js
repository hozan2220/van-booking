document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const calendarEl = document.getElementById('calendar');
    const currentMonthEl = document.getElementById('currentMonth');
    const prevMonthBtn = document.getElementById('prevMonth');
    const nextMonthBtn = document.getElementById('nextMonth');
    const bookingForm = document.getElementById('bookingForm');
    const bookingModal = document.getElementById('bookingModal');
    const bookingsModal = document.getElementById('bookingsModal');
    const closeBtns = document.querySelectorAll('.close');
    const modalDateEl = document.getElementById('modalDate');
    const bookingDetailsEl = document.getElementById('bookingDetails');
    const timeWarningEl = document.getElementById('timeWarning');
    const returnTimeWarningEl = document.getElementById('returnTimeWarning');
    const projectSelect = document.getElementById('project');
    const destinationSelect = document.getElementById('destination');
    const projectLockMessage = document.getElementById('projectLockMessage');
    const addBookingBtn = document.getElementById('addBookingBtn');
    const customDestinationGroup = document.getElementById('customDestinationGroup');
    const customDestinationInput = document.getElementById('customDestination');

    let pendingEnrollment = null;

    let currentDate = new Date();
    let selectedProjectName = '';
    let isProjectLocked = false;
    let eventSource = null;
    let cachedBookingsData = new Map();
    let customTripsData = [];
    let isCustomDestination = false;

    // Initialize
    renderCalendar(currentDate);
    setupEventListeners();
    initFloatingLabels();
    initSSE();
    initializeCustomTrips();
initializeConfirmationModal();

    function loadDatabase() {
        return {
            destinations: window.destinationsData || [],
            projects: window.projectsData || []
        };
    }

    function initSSE() {
        if (eventSource) {
            eventSource.close();
        }

        eventSource = new EventSource('/events');
        
        eventSource.onopen = function() {
            console.log('SSE connection opened');
        };

        eventSource.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                handleSSEUpdate(data);
            } catch (error) {
                console.error('Error parsing SSE data:', error);
            }
        };

        eventSource.onerror = function(error) {
            console.error('SSE error:', error);
            setTimeout(() => {
                console.log('Attempting to reconnect SSE...');
                initSSE();
            }, 5000);
        };
    }
// Add this function near the top of your script.js file, after the initial variable declarations
function setMinimumDates() {
    const today = new Date();
    const todayString = today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    
    const goDateInput = document.getElementById('goDate');
    const returnDateInput = document.getElementById('returnDate');
    
    // Set minimum date to today for both inputs
    goDateInput.min = todayString;
    returnDateInput.min = todayString;
    
    // Clear any existing dates that are before today
    if (goDateInput.value && goDateInput.value < todayString) {
        goDateInput.value = '';
        showToast('تاريخ الذهاب لا يمكن ان يكون في الماضي', 'error');
    }
    
    if (returnDateInput.value && returnDateInput.value < todayString) {
        returnDateInput.value = '';
        showToast('تاريخ العودة لا يمكن ان يكون في الماضي', 'error');
    }
}

// Add this validation function
function validateDateNotInPast(dateInput, dateType) {
    const selectedDate = dateInput.value;
    const today = new Date().toISOString().split('T')[0];
    
    if (selectedDate && selectedDate < today) {
        dateInput.value = '';
        showToast(`${dateType} date cannot be in the past`, 'error');
        return false;
    }
    return true;
}

    function initializeCustomTrips() {
        loadCustomTrips();
        setupCustomDestinationHandling();
    }

function setupCustomDestinationHandling() {
    destinationSelect.addEventListener('change', function() {
        const selectedValue = this.value;
        
        if (selectedValue === 'custom') {
            customDestinationGroup.style.display = 'block';
            customDestinationInput.required = true;
            isCustomDestination = true;
            showAllProjects();
            clearDateFields();
            resetTripSelection();
        } else if (selectedValue === '' || selectedValue === null) {
            customDestinationGroup.style.display = 'none';
            customDestinationInput.required = false;
            isCustomDestination = false;
            filterProjectsByDestination(null);
            clearDateFields();
            resetTripSelection();
        } else {
            customDestinationGroup.style.display = 'none';
            customDestinationInput.required = false;
            isCustomDestination = false;
            const selectedOption = this.options[this.selectedIndex];
            const destinationId = selectedOption.getAttribute('data-destination-id');
            filterProjectsByDestination(destinationId);
            clearDateFields();
            resetTripSelection();
        }
    });
    
    if (customDestinationInput) {
        customDestinationInput.addEventListener('focus', function() {
            if (this.nextElementSibling) {
                this.nextElementSibling.classList.add('active');
            }
        });
        
        customDestinationInput.addEventListener('blur', function() {
            if (!this.value && this.nextElementSibling) {
                this.nextElementSibling.classList.remove('active');
            }
        });
        
        // Check for existing custom trips when destination is entered or changed
        customDestinationInput.addEventListener('blur', function() {
            if (this.value && this.value.trim() !== '') {
                // Check immediately when destination is set
                checkForCustomTripsWithCurrentDates();
            }
        });
        
        // Also check when destination is typed (with debounce)
        let destinationTimeout;
        customDestinationInput.addEventListener('input', function() {
            clearTimeout(destinationTimeout);
            destinationTimeout = setTimeout(() => {
                if (this.value && this.value.trim() !== '') {
                    checkForCustomTripsWithCurrentDates();
                }
            }, 500); // 500ms debounce
        });
    }
    
    // FIXED: Add event listeners to date inputs to check custom trips when ANY date changes
    document.getElementById('goDate').addEventListener('change', function() {
        if (isCustomDestination) {
            checkForCustomTripsWithCurrentDates();
        }
    });
    
    document.getElementById('returnDate').addEventListener('change', function() {
        if (isCustomDestination) {
            checkForCustomTripsWithCurrentDates();
        }
    });
}
function checkForCustomTripsWithCurrentDates() {
    const customDestination = document.getElementById('customDestination').value;
    const goDate = document.getElementById('goDate').value;
    const returnDate = document.getElementById('returnDate').value;
    
    // Must have destination
    if (!customDestination || customDestination.trim() === '') {
        clearCustomTripWarnings();
        return;
    }
    
    // Must have at least one date
    if (!goDate && !returnDate) {
        clearCustomTripWarnings();
        return;
    }
    
    console.log('Checking custom trips for:', {
        destination: customDestination,
        goDate: goDate,
        returnDate: returnDate
    });
    
    showLoading(true);
    
    // Build the query parameters based on what's available
    const params = new URLSearchParams({
        destination: customDestination.trim()
    });
    
    if (goDate) params.append('goDate', goDate);
    if (returnDate) params.append('returnDate', returnDate);
    
    fetch(`/check-custom-trip?${params}`)
        .then(res => res.json())
        .then(result => {
            console.log('Custom trip check result:', result);
            displayCustomTripWarnings(result, customDestination, goDate, returnDate);
        })
        .catch(error => {
            console.error('Error checking custom trips:', error);
            showToast('Failed to check existing custom trips', 'error');
        })
        .finally(() => showLoading(false));
}

function checkExistingCustomTrips() {
    checkForCustomTripsWithCurrentDates();
}

// NEW FUNCTION: Display warnings based on available trip information
function displayCustomTripWarnings(result, destination, goDate, returnDate) {
    const timeWarning = document.getElementById('timeWarning');
    const returnTimeWarning = document.getElementById('returnTimeWarning');
    
    // Clear existing warnings first
    clearCustomTripWarnings();
    
    if (!result.hasExistingTrips) {
        console.log('No existing trips found');
        return; // No existing trips found
    }
    
    console.log('Existing trips found:', result);
    
    // Handle departure trip warning (show if goDate is set AND there's a departure trip)
    if (result.departureTrip && goDate) {
        console.log('Showing departure trip warning');
        let warningMessage = '<i class="fas fa-info-circle"></i><div>';
        warningMessage += `<strong>توجد مسبقاً رحلة ذهاب الى${destination}</strong><br>`;
        warningMessage += `<small>موعد الذهاب: ${result.departureTrip.goDate} - ${result.departureTrip.goTime} (${result.departureTrip.availableSeats} مقاعد متبقية)</small><br>`;
        warningMessage += '<em style="color: #666; font-size: 0.9em;">سيتم ضمك بشكل تلقائي الى رحلة الذهاب هذه.</em>';
        warningMessage += '</div>';
        
        timeWarning.className = 'time-warning info';
        timeWarning.innerHTML = warningMessage;
        timeWarning.style.display = 'flex';
        
        // Auto-fill and disable the departure time
        document.getElementById('goTime').value = result.departureTrip.goTime;
        document.getElementById('goTime').disabled = true;
    }
    
    // Handle return trip warning (show if returnDate is set AND there's a return trip)
    if (result.returnTrip && returnDate) {
        console.log('Showing return trip warning');
        let warningMessage = '<i class="fas fa-info-circle"></i><div>';
        warningMessage += `<strong>توجد مسبقاً رحلة عودة من ${destination}</strong><br>`;
        warningMessage += `<small>موعد العودة: ${result.returnTrip.returnDate} - ${result.returnTrip.returnTime} (${result.returnTrip.availableSeats} مقاعد متبقية)</small><br>`;
        warningMessage += '<em style="color: #666; font-size: 0.9em;">سيتم ضمك بشكل تلقائي الى رحلة الاياب هذه.</em>';
        warningMessage += '</div>';
        
        returnTimeWarning.className = 'time-warning info';
        returnTimeWarning.innerHTML = warningMessage;
        returnTimeWarning.style.display = 'flex';
        
        // Auto-fill and disable the return time
        document.getElementById('returnTime').value = result.returnTrip.returnTime;
        document.getElementById('returnTime').disabled = true;
    }
    
    // Show informational messages about available trips for unset dates
    if (result.departureTrip && !goDate && returnDate) {
        console.log('Showing available departure info');
        let infoMessage = '<i class="fas fa-info-circle"></i><div>';
        infoMessage += `<strong>Available departure trip to ${destination}</strong><br>`;
        infoMessage += `<small>Departure: ${result.departureTrip.goDate} at ${result.departureTrip.goTime} (${result.departureTrip.availableSeats} seats left)</small><br>`;
        infoMessage += `<em style="color: #666; font-size: 0.9em;">Set the departure date to ${result.departureTrip.goDate} to join this trip.</em>`;
        infoMessage += '</div>';
        
        timeWarning.className = 'time-warning info';
        timeWarning.innerHTML = infoMessage;
        timeWarning.style.display = 'flex';
    }
    
    if (result.returnTrip && goDate && !returnDate) {
        console.log('Showing available return info');
        let infoMessage = '<i class="fas fa-info-circle"></i><div>';
        infoMessage += `<strong>Available return trip from ${destination}</strong><br>`;
        infoMessage += `<small>Return: ${result.returnTrip.returnDate} at ${result.returnTrip.returnTime} (${result.returnTrip.availableSeats} seats left)</small><br>`;
        infoMessage += `<em style="color: #666; font-size: 0.9em;">Set the return date to ${result.returnTrip.returnDate} to join this trip.</em>`;
        infoMessage += '</div>';
        
        returnTimeWarning.className = 'time-warning info';
        returnTimeWarning.innerHTML = infoMessage;
        returnTimeWarning.style.display = 'flex';
    }
}
// Initialize confirmation modal when DOM is loaded
function initializeConfirmationModal() {
    const confirmationModal = document.getElementById('confirmationModal');
    const cancelBtn = document.getElementById('cancelEnrollment');
    const confirmBtn = document.getElementById('confirmEnrollment');
    const closeBtns = document.querySelectorAll('.close');

    // Set initial Arabic text for the confirm button
    confirmBtn.innerHTML = '<i class="fas fa-check"></i> تأكيد الانضمام';

    // Add confirmation modal to close buttons handler
    closeBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) {
                if (modal.id === 'confirmationModal') {
                    closeConfirmationModal();
                } else if (modal.id === 'myBookingsModal') {
                    closeMyBookingsModal();
                } else {
                    closeModal();
                }
            }
        });
    });

    // Cancel enrollment
    cancelBtn.addEventListener('click', closeConfirmationModal);
cancelBtn.innerHTML = '<i class="fas fa-check"></i> إغلاق';

    // Confirm enrollment
    confirmBtn.addEventListener('click', function() {
        if (pendingEnrollment) {
            if (pendingEnrollment.type === 'custom') {
                proceedWithCustomEnrollment(pendingEnrollment.tripId, pendingEnrollment.tripType);
            } else {
                proceedWithRegularEnrollment(pendingEnrollment.tripId);
            }
        }
    });

    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === bookingModal || e.target === bookingsModal) {
            closeModal();
        } else if (e.target === document.getElementById('myBookingsModal')) {
            closeMyBookingsModal();
        } else if (e.target === document.getElementById('confirmationModal')) {
            closeConfirmationModal();
        }
    });
}

// Show confirmation for regular trip enrollment
function showRegularTripConfirmation(tripId, tripData) {
    const modal = document.getElementById('confirmationModal');
    const title = document.getElementById('confirmationTitle');
    const message = document.getElementById('confirmationMessage');

    title.textContent = 'تأكيد الانضمام';
    
    const tripType = tripData.isReturnTrip ? 'عودة' : 'ذهاب';
    const seatsLeft = 8 - tripData.passengerCount;
    
    message.innerHTML = `
        <h4><i class="fas fa-info-circle"></i> You are about to enroll in this trip</h4>
        <div class="trip-details">
            <div class="trip-detail-item">
                <i class="fas fa-${tripData.isReturnTrip ? 'arrow-left' : 'arrow-right'}"></i>
                <strong>${tripType} Trip</strong>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-map-marker-alt"></i>
                <span>الوجهة: ${tripData.destination}</span>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-briefcase"></i>
                <span>المشروع: ${tripData.projectName}</span>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-clock"></i>
                <span>التوقيت: ${tripData.time}</span>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-users"></i>
                <span>المقاعد المتوفرة:  ${seatsLeft}/8</span>
            </div>
            ${tripData.vanId ? `
                <div class="trip-detail-item">
                    <i class="fas fa-van-shuttle"></i>
                    <span>السائق: ${tripData.driver}</span>
                </div>
            ` : `
                <div class="trip-detail-item">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span style="color: #ff6b35;">لم يتم تخصيص فان</span>
                </div>
            `}
        </div>
    `;

    // Store enrollment data
    pendingEnrollment = {
        type: 'regular',
        tripId: tripId
    };

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

// Show confirmation for custom trip enrollment  
function showCustomTripConfirmation(tripId, tripType, tripData) {
    const modal = document.getElementById('confirmationModal');
    const title = document.getElementById('confirmationTitle');
    const message = document.getElementById('confirmationMessage');

    title.textContent = 'تأكيد الانضمام';
    
    const isReturn = tripType === 'return';
    const seatsLeft = 8 - tripData.passengerCount;
    const date = isReturn ? tripData.returnDate : tripData.goDate;
    const time = isReturn ? tripData.returnTime : tripData.goTime;
    
    message.innerHTML = `
        <div class="trip-details">
            <div class="trip-detail-item">
                <i class="fas fa-${isReturn ? 'arrow-left' : 'arrow-right'}"></i>
                <strong>  رحلة ${isReturn ? ' عودة ' : ' ذهاب '} </strong>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-map-marker-alt"></i>
                <span>الوجهة: ${tripData.destination}</span>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-calendar"></i>
                <span>التاريخ: ${date}</span>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-clock"></i>
                <span>التوقيت: ${time}</span>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-users"></i>
                <span>المقاعد المتوفرة: ${seatsLeft}/8</span>
            </div>
            ${tripData.van ? `
                <div class="trip-detail-item">
                    <i class="fas fa-van-shuttle"></i>
                    <span>السائق: ${tripData.van.driver}</span>
                </div>
            ` : `
                <div class="trip-detail-item">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span style="color: #ff6b35;">لم يتم تخصيص فان بعد</span>
                </div>
            `}
            ${tripData.isClosed ? `
                <div class="trip-detail-item">
                    <i class="fas fa-lock"></i>
                    <span style="color: #dc3545;">This trip is closed to new enrollments</span>
                </div>
            ` : ''}
        </div>
    `;

    // Store enrollment data
    pendingEnrollment = {
        type: 'custom',
        tripId: tripId,
        tripType: tripType
    };

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

// Close confirmation modal
function closeConfirmationModal() {
    const modal = document.getElementById('confirmationModal');
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
    pendingEnrollment = null;
}

// Proceed with regular trip enrollment
// Update the confirm enrollment handler
function proceedWithRegularEnrollment(tripId) {
    const confirmBtn = document.getElementById('confirmEnrollment');
    const cancelBtn = document.getElementById('cancelEnrollment');
    
    // Get the preferred time if this is a time-input enrollment
    let preferredTime = null;
    const timeInput = document.getElementById('preferredTime');
    if (timeInput && pendingEnrollment?.type === 'regular-with-time') {
        preferredTime = timeInput.value;
    }
    
    // Disable buttons during enrollment
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارٍ الانضمام للرحلة';
    
    showLoading(true);
    
    // Prepare request body
    const requestBody = {};
    if (preferredTime) {
        requestBody.preferredTime = preferredTime;
    }
    
    fetch(`/enroll-trip/${tripId}`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify(requestBody)
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(err => {
                throw new Error(err.error || 'Failed to enroll');
            });
        }
        return res.json();
    })
    .then(result => {
        if (result.success) {
            closeConfirmationModal();
            
            let message = '🎉 تم بنجاح الانضمام للرحلة!';
            if (result.timeUpdated) {
                // Safely get trip type from pending enrollment data
                const isReturnTrip = pendingEnrollment?.tripData?.isReturnTrip || false;
                const tripType = isReturnTrip ? 'عودة' : 'ذهاب';
                message += ` ⏰ تم تحديث توقيت الرحلة الى ${result.newTime}.`;
            }
            
            showToast(message, 'success');
            
            // Refresh the modal if it's open
            if (bookingsModal.style.display === 'flex') {
                const currentDateStr = modalDateEl.textContent.match(/\d{4}-\d{2}-\d{2}/);
                if (currentDateStr) {
                    fetchBookingsForDate(currentDateStr[0], document.createElement('div'))
                        .then(trips => {
                            showBookings(currentDateStr[0], trips);
                        });
                }
            }
        } else {
            throw new Error(result.error || 'Enrollment failed');
        }
    })
    .catch(error => {
        console.error('Enrollment error:', error);
        showToast(error.message, 'error');
    })
    .finally(() => {
        showLoading(false);
        // Re-enable buttons
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-check"></i> تأكيد الانضمام';
    });
}

// Proceed with custom trip enrollment
function proceedWithCustomEnrollment(tripId, tripType) {
    const confirmBtn = document.getElementById('confirmEnrollment');
    const cancelBtn = document.getElementById('cancelEnrollment');
    
    // Disable buttons during enrollment
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارٍ الانضمام للرحلة';
    
    showLoading(true);
    
    fetch(`/enroll-custom-trip/${tripId}`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}`
        },
        credentials: 'include'
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(err => {
                throw new Error(err.error || 'Failed to enroll');
            });
        }
        return res.json();
    })
    .then(result => {
        if (result.success) {
            closeConfirmationModal();
            showToast(`🎉 تم بنجاح الانضمام للرحلة المخصصة!`, 'success');
            loadCustomTrips(); // Refresh the list
        } else {
            throw new Error(result.error || 'Enrollment failed');
        }
    })
    .catch(error => {
        console.error('Enrollment error:', error);
        showToast(error.message, 'error');
    })
    .finally(() => {
        showLoading(false);
        // Re-enable buttons
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-check"></i> تأكيد الانضمام';
    });
}
// NEW FUNCTION: Clear all custom trip warnings
function clearCustomTripWarnings() {
    const timeWarning = document.getElementById('timeWarning');
    const returnTimeWarning = document.getElementById('returnTimeWarning');
    
    timeWarning.style.display = 'none';
    returnTimeWarning.style.display = 'none';
    
    // Re-enable time inputs if they were disabled by custom trip logic
    if (isCustomDestination) {
        document.getElementById('goTime').disabled = false;
        document.getElementById('returnTime').disabled = false;
        document.getElementById('goTime').value = '';
        document.getElementById('returnTime').value = '';
    }
}

// UPDATE: Replace the old checkExistingCustomTrips function with this simpler version
function checkExistingCustomTrips() {
    // This function is now just an alias to the new function for backwards compatibility
    checkExistingCustomTripsForCurrentInputs();
}

    function showAllProjects() {
        const allProjectOptions = Array.from(projectSelect.querySelectorAll('option'));
        
        allProjectOptions.forEach(option => {
            if (option.value && option.value !== '') {
                const remainingTrips = parseInt(option.getAttribute('data-journeys')) || 0;
                
                option.style.display = '';
                option.style.visibility = 'visible';
                option.hidden = false;
                option.removeAttribute('hidden');
                
                if (remainingTrips <= 0) {
                    option.disabled = true;
                    option.style.color = '#999';
                    option.style.backgroundColor = '#f5f5f5';
                    if (!option.textContent.includes('UNAVAILABLE')) {
                        option.textContent = option.textContent.replace(/\d+ remaining\)/, '0 trips - UNAVAILABLE)');
                    }
                } else {
                    option.disabled = false;
                    option.style.color = '';
                    option.style.backgroundColor = '';
                    if (option.textContent.includes('UNAVAILABLE')) {
                        option.textContent = option.textContent.replace('0 trips - UNAVAILABLE)', `${remainingTrips} remaining)`);
                    }
                }
            }
        });
        
        projectSelect.value = '';
        projectSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

function loadCustomTrips() {
    fetch('/custom-trips')
        .then(res => res.json())
        .then(trips => {
            customTripsData = trips;
            updateCustomTripsNotification();
            
            // If custom trips modal is open, refresh it
            if (document.getElementById('customTripsModal')?.style.display === 'flex') {
                renderCustomTripsModal(trips);
            }
        })
        .catch(error => {
            console.error('Failed to load custom trips:', error);
            showToast('Failed to load custom trips', 'error');
        });
}

   // Add this function to your script.js file (modify the existing updateCustomTripsNotification function)

function updateCustomTripsNotification() {
    const notification = document.getElementById('customTripsNotification');
    const content = document.getElementById('customTripsContent');
    const dashboardGrid = document.querySelector('.dashboard-grid');
    
    if (customTripsData.length === 0) {
        notification.style.display = 'none';
        if (dashboardGrid) {
            dashboardGrid.classList.add('no-custom-trips');
        }
        return;
    }
    
    notification.style.display = 'block';
    if (dashboardGrid) {
        dashboardGrid.classList.remove('no-custom-trips');
    }
    
    const tripsByDestination = {};
    customTripsData.forEach(trip => {
        if (!tripsByDestination[trip.destination]) {
            tripsByDestination[trip.destination] = { departures: [], returns: [] };
        }
        
        if (trip.isReturnTrip) {
            tripsByDestination[trip.destination].returns.push(trip);
        } else {
            tripsByDestination[trip.destination].departures.push(trip);
        }
    });
    
    content.innerHTML = Object.entries(tripsByDestination).map(([destination, trips]) => {
        let html = `
            <div class="custom-trip-item">
                <div class="custom-trip-header">
                    <div class="custom-trip-destination">
                        <i class="fas fa-map-marker-alt"></i> ${destination}
                    </div>
                </div>
                <div class="custom-trip-details">
        `;
        
        // Show all departure trips for this destination
        if (trips.departures.length > 0) {
            trips.departures.forEach(trip => {
                const isFull = trip.passengerCount >= 8;
                const isClosed = trip.isClosed;
                
                html += `
                    <div class="custom-trip-segment ${isFull ? 'full-trip' : ''} ${isClosed ? 'closed-trip' : ''}" 
                         data-trip-id="${trip.id}" data-trip-type="departure">
                        <div class="custom-trip-date">
<span>
  <strong>📅التاريخ:</strong> ${trip.goDate} &nbsp;  &nbsp; 
  <strong>⏰الساعة:</strong> ${trip.goTime}
</span>                            ${isFull ? '<span class="trip-status-badge full">FULL</span>' : ''}
                            ${isClosed ? '<span class="trip-status-badge closed">CLOSED</span>' : ''}
                        </div>
                        <div class="custom-trip-meta">
                            <div class="custom-trip-passengers">
                                <i class="fas fa-users"></i>
                                <span>${trip.passengerCount}/8 ركاب</span>
                            </div>
                            <div class="custom-trip-van">
                                <i class="fas fa-van-shuttle"></i>
                                <span>${trip.van ? trip.van.driver : 'لم يتم تخصيص فان'}</span>
                            </div>
                        </div>
                        <div class="custom-trip-actions">
                            ${!isFull && !isClosed ? `
                                <button class="custom-enroll-btn available" data-trip-id="${trip.id}" data-trip-type="departure">
                                    <i class="fas fa-user-plus"></i> أنضم لرحلة الذهاب
                                </button>
                            ` : `
                                <button class="custom-enroll-btn disabled" disabled>
                                    <i class="fas fa-${isClosed ? 'lock' : 'users'}"></i> 
                                    ${isClosed ? 'Closed' : 'Full'}
                                </button>
                            `}
                        </div>
                        ${isClosed ? '<div class="trip-closed-message">This trip is closed to new enrollments</div>' : ''}
                    </div>
                `;
            });
        }
        
        // Show all return trips for this destination
        if (trips.returns.length > 0) {
            trips.returns.forEach(trip => {
                const isFull = trip.passengerCount >= 8;
                const isClosed = trip.isClosed;
                
                html += `
                    <div class="custom-trip-segment ${isFull ? 'full-trip' : ''} ${isClosed ? 'closed-trip' : ''}" 
                         data-trip-id="${trip.id}" data-trip-type="return">
                        <div class="custom-trip-date">

<span>
  <strong>📅التاريخ:</strong> ${trip.returnDate} &nbsp;  &nbsp; 
  <strong>⏰الساعة:</strong> ${trip.returnTime}
</span>                             ${isFull ? '<span class="trip-status-badge full">FULL</span>' : ''}
                            ${isClosed ? '<span class="trip-status-badge closed">CLOSED</span>' : ''}
                        </div>
                        <div class="custom-trip-meta">
                            <div class="custom-trip-passengers">
                                <i class="fas fa-users"></i>
                                <span>${trip.passengerCount}/8 ركاب</span>
                            </div>
                            <div class="custom-trip-van">
                                <i class="fas fa-van-shuttle"></i>
                                <span>${trip.van ? trip.van.driver : 'لم يتم تخصيص فان'}</span>
                            </div>
                        </div>
                        <div class="custom-trip-actions">
                            ${!isFull && !isClosed ? `
                                <button class="custom-enroll-btn available" data-trip-id="${trip.id}" data-trip-type="return">
                                    <i class="fas fa-user-plus"></i> أنضم لرحلة العودة
                                </button>
                            ` : `
                                <button class="custom-enroll-btn disabled" disabled>
                                    <i class="fas fa-${isClosed ? 'lock' : 'users'}"></i> 
                                    ${isClosed ? 'Closed' : 'Full'}
                                </button>
                            `}
                        </div>
                        ${isClosed ? '<div class="trip-closed-message">This trip is closed to new enrollments</div>' : ''}
                    </div>
                `;
            });
        }
        
        html += `
                </div>
            </div>
        `;
        
        return html;
    }).join('');
    
    // Add event listeners to all available custom enroll buttons
    document.querySelectorAll('.custom-enroll-btn.available').forEach(btn => {
        btn.addEventListener('click', function() {
            const tripId = this.getAttribute('data-trip-id');
            const tripType = this.getAttribute('data-trip-type');
            enrollInCustomTrip(tripId, tripType);
        });
    });
}
function updateCustomTripStatus(tripId, isClosed) {
    const tripSegments = document.querySelectorAll(`.custom-trip-segment[data-trip-id="${tripId}"]`);
    
    tripSegments.forEach(segment => {
        // Add animation
        segment.style.transition = 'all 0.3s ease';
        segment.style.transform = 'scale(1.02)';
        
        setTimeout(() => {
            segment.style.transform = 'scale(1)';
            
            // Update classes
            if (isClosed) {
                segment.classList.add('closed-trip');
                segment.classList.remove('full-trip');
            } else {
                segment.classList.remove('closed-trip');
            }
            
            // Update status badge
            const statusBadge = segment.querySelector('.trip-status-badge');
            if (isClosed) {
                if (!statusBadge || statusBadge.classList.contains('full')) {
                    const badge = document.createElement('span');
                    badge.className = 'trip-status-badge closed';
                    badge.textContent = 'CLOSED';
                    segment.querySelector('.custom-trip-date').appendChild(badge);
                } else if (statusBadge) {
                    statusBadge.className = 'trip-status-badge closed';
                    statusBadge.textContent = 'CLOSED';
                }
            } else {
                if (statusBadge && statusBadge.classList.contains('closed')) {
                    statusBadge.remove();
                }
            }
            
            // Update enroll button
            const enrollBtn = segment.querySelector('.custom-enroll-btn');
            if (enrollBtn) {
                if (isClosed) {
                    enrollBtn.disabled = true;
                    enrollBtn.innerHTML = '<i class="fas fa-lock"></i> Closed';
                    enrollBtn.className = 'custom-enroll-btn disabled';
                } else {
                    const passengerCount = parseInt(segment.querySelector('.custom-trip-passengers span').textContent.split('/')[0]);
                    if (passengerCount < 8) {
                        enrollBtn.disabled = false;
                        enrollBtn.innerHTML = '<i class="fas fa-user-plus"></i> Join ' + 
                            (segment.getAttribute('data-trip-type') === 'departure' ? 'Departure' : 'Return');
                        enrollBtn.className = 'custom-enroll-btn available';
                    }
                }
            }
            
            // Update closed message
            let closedMessage = segment.querySelector('.trip-closed-message');
            if (isClosed) {
                if (!closedMessage) {
                    closedMessage = document.createElement('div');
                    closedMessage.className = 'trip-closed-message';
                    closedMessage.textContent = 'This trip is closed to new enrollments';
                    segment.appendChild(closedMessage);
                }
            } else if (closedMessage) {
                closedMessage.remove();
            }
        }, 300);
    });
}
// The issue is in the enrollInCustomTrip function. Here's the corrected version:

function enrollInCustomTrip(tripId, type) {
    // Find the trip data from the DOM
    const tripElement = document.querySelector(`.custom-trip-segment[data-trip-id="${tripId}"]`);
    
    if (!tripElement) {
        showToast('Trip data not found', 'error');
        return;
    }

    // Extract trip data from the custom trips data
    const tripData = customTripsData.find(trip => trip.id.toString() === tripId.toString());
    
    if (!tripData) {
        showToast('Trip information not found', 'error');
        return;
    }

    // Show confirmation dialog
    showCustomTripConfirmation(tripId, type, tripData);
}
// Also, let's make sure the getAuthToken function is robust:
function getAuthToken() {
    // Get all cookies
    const cookies = document.cookie.split('; ');
    
    // Look for the correct cookie name that your server sets
    const tokenCookie = cookies.find(row => row.startsWith('sb-access-token='));
    
    if (tokenCookie) {
        return tokenCookie.split('=')[1];
    }
    
    console.log('No auth token found in cookies');
    return '';
}
// Alternative approach - if the above doesn't work, try matching exactly how regular enrollment works:
function enrollInCustomTripAlternative(tripId, type) {
    showLoading(true);
    
    // Match the exact pattern of enrollInTrip - no explicit token handling
    fetch(`/enroll-custom-trip/${tripId}`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json'
            // Remove Authorization header entirely and let the backend handle auth the same way as regular trips
        }
        // No body at all, just like enrollInTrip
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(err => {
                throw new Error(err.error || 'Failed to enroll');
            });
        }
        return res.json();
    })
    .then(result => {
        if (result.success) {
            showToast(`تم بنجاح الانضمام للرحلة المخصصة!`, 'success');
            loadCustomTrips(); // Refresh the list
        } else {
            throw new Error(result.error || 'Enrollment failed');
        }
    })
    .catch(error => {
        console.error('Enrollment error:', error);
        showToast(error.message, 'error');
    })
    .finally(() => showLoading(false));
}
    function toggleCustomTripsNotification() {
        const notification = document.getElementById('customTripsNotification');
        const icon = notification.querySelector('.collapse-btn i');
        
        notification.classList.toggle('collapsed');
        icon.className = notification.classList.contains('collapsed') 
            ? 'fas fa-chevron-down' 
            : 'fas fa-chevron-up';
    }
// Update the handleBookingSubmit function to handle custom destinations
  // FIXED: Update the handleCustomBookingSubmit function to prevent duplicate submissions
function handleCustomBookingSubmit(e) {
    // Prevent any further event propagation
    e.stopPropagation();
    
    if (!validateTimes()) {
        return;
    }
    
    const formData = new FormData(bookingForm);
    const data = Object.fromEntries(formData.entries());
    data.email = 'user@drd-me.org';

    // Handle custom destination
    const customDestination = document.getElementById('customDestination').value;
    if (!customDestination || customDestination.trim() === '') {
        showToast('Please enter a custom destination', 'error');
        return;
    }
    data.destination = customDestination.trim();

    if (!data.projectId || data.projectId === '') {
        showToast('Please select a project', 'error');
        return;
    }

    // Disable the form to prevent double submission
    const submitButton = bookingForm.querySelector('button[type="submit"]');
    const originalText = submitButton.innerHTML;
    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارٍ الحجز';

    showLoading(true);
    
    // Make the API call to create custom trips
    fetch('/book-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(err => {
                throw new Error(err.error || 'Network response was not ok');
            });
        }
        return res.json();
    })
    .then(result => {
        if (result.success) {
            showToast(result.message || '🎉 تم فتح رحلة مخصصة والانضمام لها!', 'success');
            
            bookingForm.reset();
            
            // Reset custom destination state
            document.getElementById('customDestinationGroup').style.display = 'none';
            document.getElementById('customDestination').required = false;
            isCustomDestination = false;
            
            cachedBookingsData.clear();
            closeModal();
            
            // Refresh custom trips
            loadCustomTrips();
            
        } else {
            throw new Error(result.error || 'Custom trip creation failed');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showToast(error.message || 'Custom trip creation failed. Please try again.', 'error');
    })
    .finally(() => {
        // Re-enable the form
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
        showLoading(false);
    });
}
// Update the existing handleSSEUpdate function to handle custom trip events
function handleCustomSSEUpdate(data) {
    switch(data.type) {
        case 'custom-trip-created':
            loadCustomTrips(); // Refresh custom trips list
            showToast('تم فتح رحلة مخصصة!', 'success');
            break;
            
        case 'custom-passenger-added':
            loadCustomTrips(); // Refresh custom trips list
            
            break;
case 'custom-booking-deleted':
 // Refresh my bookings modal if open
    if (document.getElementById('myBookingsModal').style.display === 'flex') {
        loadMyBookings();
    }
    // Refresh calendar and custom trips
    cachedBookingsData.clear();
    renderCalendar(currentDate);
    loadCustomTrips();
    break;

    }
}

// Update the handleCustomSSEUpdate function or add it to the main handleSSEUpdate function
function handleSSEUpdate(data) {
    console.log('SSE Update received:', data);
    
    switch(data.type) {
        case 'init':
            renderCalendar(currentDate);
            break;
            
        case 'passenger-added':
            handlePassengerAdded(data);
            break;
        case 'booking-deleted':
            handleBookingDeleted(data, false); // false for regular trips
            break;
            
        case 'custom-booking-deleted':
            handleBookingDeleted(data, true); // true for custom trips
            break;
            
        case 'booking-added':
            handleBookingAdded(data);
            break;
            case 'booking-deleted':
    // Refresh my bookings modal if open
    if (document.getElementById('myBookingsModal').style.display === 'flex') {
        loadMyBookings();
    }
    // Refresh calendar and custom trips
    cachedBookingsData.clear();
    renderCalendar(currentDate);
    loadCustomTrips();
    break;
        case 'trip-time-updated':
            handleTripTimeUpdate(data);
            break;

        case 'trip-completed':
            cachedBookingsData.clear();
            renderCalendar(currentDate);
            
            if (bookingsModal.style.display === 'flex') {
                const currentDateStr = modalDateEl.textContent.match(/\d{4}-\d{2}-\d{2}/);
                if (currentDateStr) {
                    fetchBookingsForDate(currentDateStr[0], document.createElement('div'))
                        .then(trips => {
                            showBookings(currentDateStr[0], trips);
                        });
                }
            }
            
            showToast(`🎉 Trip completed successfully! Project has ${data.remainingTrips} trips remaining.`, 'success');
            break;

        case 'van-assigned':
            // Handle both regular and custom trips
            cachedBookingsData.clear();
            renderCalendar(currentDate);
            
            // Refresh custom trips list if a custom trip was updated
            if (data.isCustom) {
                loadCustomTrips();
            }
            
            if (bookingsModal.style.display === 'flex') {
                const currentDateStr = modalDateEl.textContent.match(/\d{4}-\d{2}-\d{2}/);
                if (currentDateStr) {
                    fetchBookingsForDate(currentDateStr[0], document.createElement('div'))
                        .then(trips => {
                            showBookings(currentDateStr[0], trips);
                        });
                }
            }
            break;
            
        case 'van-released':
            cachedBookingsData.clear();
            renderCalendar(currentDate);
            
            // Refresh custom trips list if a custom trip was updated
            if (data.isCustom) {
                loadCustomTrips();
            }
            
            if (bookingsModal.style.display === 'flex') {
                const currentDateStr = modalDateEl.textContent.match(/\d{4}-\d{2}-\d{2}/);
                if (currentDateStr) {
                    fetchBookingsForDate(currentDateStr[0], document.createElement('div'))
                        .then(trips => {
                            showBookings(currentDateStr[0], trips);
                        });
                }
            }
            break;
            
        case 'trip-closed':
                      case 'trip-reopened':
            // Handle both regular and custom trips
            if (data.isCustom) {
                updateCustomTripStatus(data.tripId, data.type === 'trip-closed');
                showToast(`تم  ${data.type === 'trip-closed' ? 'اغلاق' : 'اعادة فتح'} الرحلة بنجاح!`, 'success');
            } else {
                handleTripStatusChange(data);
            }
            break;

        case 'custom-trip-created':
            loadCustomTrips();
            showToast('Custom trip created successfully!', 'success');
            break;
            
        case 'custom-passenger-added':
            loadCustomTrips();
           
            break;
            
        default:
            console.log('Unknown SSE event type:', data.type);
    }
}
function handleBookingDeleted(data, isCustom) {
    const { tripId, remainingPassengerCount, passengerName } = data;
    
    // Update the calendar if needed
    cachedBookingsData.clear();
    renderCalendar(currentDate);
    
    // Update custom trips notification if it's a custom trip
    if (isCustom) {
        loadCustomTrips();
    }
    
    // Update the bookings modal if it's open
    if (bookingsModal.style.display === 'flex') {
        updateModalPassengerCount(tripId, remainingPassengerCount, isCustom);
    }
    
    // Update my bookings modal if it's open
    if (document.getElementById('myBookingsModal').style.display === 'flex') {
        loadMyBookings();
    }
    
    // Show a notification about the cancellation
    showToast(`${passengerName} cancelled their booking. ${remainingPassengerCount} passengers remaining.`, 'info');
}

// Function to update passenger count in the modal
function updateModalPassengerCount(tripId, newPassengerCount, isCustom) {
    const bookingItems = document.querySelectorAll('.booking-item');
    
    bookingItems.forEach(item => {
        const enrollBtn = item.querySelector(`[data-trip-id="${tripId}"]`);
        if (enrollBtn) {
            // Update passenger count displays
            const passengerCountEls = item.querySelectorAll('.passenger-count');
            if (passengerCountEls.length >= 2) {
                passengerCountEls[0].textContent = `${newPassengerCount} ركاب`;
                passengerCountEls[1].textContent = `${8 - newPassengerCount} مقاعد متوفرة`;
                
                // Add animation to highlight the change
                passengerCountEls[0].classList.add('updated-count');
                passengerCountEls[1].classList.add('updated-count');
                setTimeout(() => {
                    passengerCountEls[0].classList.remove('updated-count');
                    passengerCountEls[1].classList.remove('updated-count');
                }, 500);
            }

            // Update enroll button if trip is no longer full
            if (newPassengerCount < 8) {
                enrollBtn.disabled = false;
                enrollBtn.innerHTML = '<i class="fas fa-user-plus"></i> انضمام';
                enrollBtn.style.background = 'linear-gradient(135deg, var(--primary), var(--primary-light))';
                
                // Remove full message if it exists
                const fullMessage = item.querySelector('.trip-full-message');
                if (fullMessage) {
                    fullMessage.remove();
                }
            }
        }
    });
}
function handleTripTimeUpdate(data) {
    const { tripId, isReturnTrip, newTime, oldTime, updatedBy } = data;
    
    // Clear cached data to force refresh
    cachedBookingsData.clear();
    
    // Refresh calendar
    renderCalendar(currentDate);
    
    // Update modal if it's open
    if (bookingsModal.style.display === 'flex') {
        const currentDateStr = modalDateEl.textContent.match(/\d{4}-\d{2}-\d{2}/);
        if (currentDateStr) {
            fetchBookingsForDate(currentDateStr[0], document.createElement('div'))
                .then(trips => {
                    showBookings(currentDateStr[0], trips);
                });
        }
    }
    
    // Show notification about time change
    const tripType = isReturnTrip ? 'عودة' : 'ذهاب';
    const timeDirection = isReturnTrip ? 
        (newTime > oldTime ? 'تم تأخير توقيت الرحلة ' : 'تم تقديم توقيت الرحلة') :
        (newTime < oldTime ? 'تم تأخير توقيت الرحلة' : 'تم تقديم توقيت الرحلة');
    
    showToast(`🕐 Trip ${tripType} time ${timeDirection} from ${oldTime} to ${newTime} (updated by ${updatedBy})`, 'info');
}
function handleTripStatusChange(data) {
    const { tripId, type } = data;
    const isClosed = type === 'trip-closed';
    
    // Clear cached data to force refresh
    cachedBookingsData.clear();
    
    // Refresh calendar to show updated status
    renderCalendar(currentDate);
    
    // If the bookings modal is open, update it in real-time
    if (bookingsModal.style.display === 'flex') {
        updateModalTripStatus(tripId, isClosed);
        
        // Also refresh the modal data
        const currentDateStr = modalDateEl.textContent.match(/\d{4}-\d{2}-\d{2}/);
        if (currentDateStr) {
            fetchBookingsForDate(currentDateStr[0], document.createElement('div'))
                .then(trips => {
                    showBookings(currentDateStr[0], trips);
                });
        }
    }
    
    // Show success toast
    const statusText = isClosed ? 'اغلاق' : 'اعادة فتح';
    showToast(`تم ${statusText}! الرحلة بنجاح`, 'success');
}

function updateModalTripStatus(tripId, isClosed) {
    const bookingItems = document.querySelectorAll('.booking-item');
    
    bookingItems.forEach(item => {
        const enrollBtn = item.querySelector(`[data-trip-id="${tripId}"]`);
        if (enrollBtn) {
            // Update the booking item classes
            if (isClosed) {
                item.classList.add('closed');
                
                // Add or update the closed status badge
                let statusBadge = item.querySelector('.trip-status-badge');
                if (!statusBadge) {
                    statusBadge = document.createElement('span');
                    statusBadge.className = 'trip-status-badge';
                    const h4 = item.querySelector('h4');
                    if (h4) h4.appendChild(statusBadge);
                }
                statusBadge.textContent = 'Closed';
                statusBadge.style.background = 'var(--danger)';
                
                // Disable enroll button
                enrollBtn.disabled = true;
                enrollBtn.innerHTML = '<i class="fas fa-lock"></i> Trip Closed';
                enrollBtn.style.background = 'var(--gray)';
                
                // Add closed message if not already present
                if (!item.querySelector('.trip-closed-message')) {
                    const closedMessage = document.createElement('p');
                    closedMessage.className = 'trip-closed-message';
                    closedMessage.style.color = 'var(--danger)';
                    closedMessage.style.marginTop = '0.5rem';
                    closedMessage.textContent = 'This trip is closed. No new enrollments allowed.';
                    item.appendChild(closedMessage);
                }
            } else {
                item.classList.remove('closed');
                
                // Remove closed status badge
                const statusBadge = item.querySelector('.trip-status-badge');
                if (statusBadge && statusBadge.textContent === 'Closed') {
                    statusBadge.remove();
                }
                
                // Re-enable enroll button if trip isn't full
                const currentCount = parseInt(enrollBtn.closest('.booking-item').querySelector('.passenger-count').textContent.match(/\d+/)[0]);
                if (currentCount < 8) {
                    enrollBtn.disabled = false;
                    enrollBtn.innerHTML = '<i class="fas fa-user-plus"></i> Enroll';
                    enrollBtn.style.background = 'linear-gradient(135deg, var(--primary), var(--primary-light))';
                }
                
                // Remove closed message
                const closedMessage = item.querySelector('.trip-closed-message');
                if (closedMessage) {
                    closedMessage.remove();
                }
            }
            
            // Add visual animation to highlight the change
            item.style.transition = 'all 0.3s ease';
            item.style.transform = 'scale(1.02)';
            setTimeout(() => {
                item.style.transform = 'scale(1)';
            }, 300);
        }
    });
}

    function handlePassengerAdded(data) {
        const { tripId, passengerName, passengerCount } = data;
        
        // Update modal if it's open and showing the relevant trip
        if (bookingsModal.style.display === 'flex') {
            updateModalPassengerCount(tripId, passengerCount);
        }
        
        // Clear cached data to force refresh on next calendar render
        cachedBookingsData.clear();
        
        // Refresh calendar to show updated counts
        renderCalendar(currentDate);
        
        // Show success toast

    }

    function handleBookingAdded(data) {
        // Clear cached data and refresh calendar
        cachedBookingsData.clear();
        renderCalendar(currentDate);
    }

    function updateModalPassengerCount(tripId, newPassengerCount) {
        const bookingItems = document.querySelectorAll('.booking-item');
        
        bookingItems.forEach(item => {
            const enrollBtn = item.querySelector(`[data-trip-id="${tripId}"]`);
            if (enrollBtn) {
                // Update passenger count displays
                const passengerCountEls = item.querySelectorAll('.passenger-count');
                if (passengerCountEls.length >= 2) {
                    passengerCountEls[0].textContent = `${newPassengerCount} ركاب`;
                    passengerCountEls[1].textContent = `${8 - newPassengerCount} مقاعد متوفرة`;
                    
                    // Add animation to highlight the change
                    passengerCountEls[0].classList.add('updated-count');
                    passengerCountEls[1].classList.add('updated-count');
                    setTimeout(() => {
                        passengerCountEls[0].classList.remove('updated-count');
                        passengerCountEls[1].classList.remove('updated-count');
                    }, 500);
                }

                // Update enroll button if trip is now full
                if (newPassengerCount >= 8) {
                    enrollBtn.disabled = true;
                    enrollBtn.innerHTML = '<i class="fas fa-user-plus"></i> Trip Full';
                    enrollBtn.style.background = 'var(--gray)';
                    
                    // Show full message if not already shown
                    if (!item.querySelector('.trip-full-message')) {
                        const fullMessage = document.createElement('p');
                        fullMessage.className = 'trip-full-message';
                        fullMessage.style.color = 'var(--danger)';
                        fullMessage.style.marginTop = '0.5rem';
                        fullMessage.textContent = 'Sorry, this trip is full. Please create a new one using the form.';
                        item.appendChild(fullMessage);
                    }
                }
            }
        });
    }

function setupEventListeners() {
    prevMonthBtn.addEventListener('click', () => updateMonth(-1));
    nextMonthBtn.addEventListener('click', () => updateMonth(1));
    closeBtns.forEach(btn => btn.addEventListener('click', closeModal));
    window.addEventListener('click', (e) => {
        if (e.target === bookingModal || e.target === bookingsModal) {
            closeModal();
        }
    });
    
    // FIXED: Single event listener that routes to correct handler
    bookingForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const destinationSelect = document.getElementById('destination');
        const isCustomDestination = destinationSelect.value === 'custom';
        
        if (isCustomDestination) {
            handleCustomBookingSubmit(e);
        } else {
            handleBookingSubmit(e);
        }
    });

    // Fix the destination change event listener
    destinationSelect.addEventListener('change', function() {
        const selectedDestination = this.value;
        
        if (!selectedDestination) {
            // If no destination selected, show all projects
            filterProjectsByDestination(null);
            clearDateFields();
            resetTripSelection();
            return;
        }
        
        // Get the destination ID from the selected option
        const selectedOption = this.options[this.selectedIndex];
        const destinationId = selectedOption.getAttribute('data-destination-id');
        
        console.log('Selected destination:', selectedDestination, 'ID:', destinationId); // Debug log
        
        filterProjectsByDestination(destinationId);
        clearDateFields();
        resetTripSelection();
    });
document.getElementById('myBookingsBtn').addEventListener('click', loadMyBookings);
    // ADD: Date validation event listeners
    document.getElementById('goDate').addEventListener('change', function() {
        // Validate the date is not in the past
        if (!validateDateNotInPast(this, 'Departure')) {
            return;
        }
        
        // Update return date minimum
        const returnDateInput = document.getElementById('returnDate');
        returnDateInput.min = this.value;
        
        // Clear return date if it's before the new departure date
        if (returnDateInput.value && new Date(returnDateInput.value) < new Date(this.value)) {
            returnDateInput.value = this.value;
            validateTimes();
        }
        
        // Run existing logic
        checkExistingTimes();
    });

    document.getElementById('returnDate').addEventListener('change', function() {
        // Validate the date is not in the past
        if (!validateDateNotInPast(this, 'Return')) {
            return;
        }
        
        // Run existing validation and logic
        validateReturnDate();
        checkReturnTimes();
        
        // For custom destinations, check existing trips
        if (isCustomDestination) {
            checkForCustomTripsWithCurrentDates();
        }
    });

    document.getElementById('goTime').addEventListener('change', validateTimes);
    document.getElementById('returnTime').addEventListener('change', validateTimes);
    document.getElementById('goDate').addEventListener('change', checkExistingTimes);
    document.getElementById('returnDate').addEventListener('change', checkReturnTimes);
    document.getElementById('returnDate').addEventListener('change', validateReturnDate);
    document.getElementById('goTime').addEventListener('change', validateTimes);
    document.getElementById('returnTime').addEventListener('change', validateTimes);
    
    document.getElementById('goDate').addEventListener('change', function() {
        const returnDateInput = document.getElementById('returnDate');
        returnDateInput.min = this.value;
        if (returnDateInput.value && new Date(returnDateInput.value) < new Date(this.value)) {
            returnDateInput.value = this.value;
            validateTimes();
        }
    });

    // Add Booking button event listener
    addBookingBtn.addEventListener('click', () => {
        bookingModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    });

    // Close SSE connection when page is unloaded
    window.addEventListener('beforeunload', function() {
        if (eventSource) {
            eventSource.close();
        }
    });

    // Add click handler for custom trips notification toggle
    document.addEventListener('click', function(e) {
        if (e.target.closest('.collapse-btn')) {
            toggleCustomTripsNotification();
        }
    });
}
// Fix 2: Add specific close handler for My Bookings modal
function closeMyBookingsModal() {
    const myBookingsModal = document.getElementById('myBookingsModal');
    myBookingsModal.style.display = 'none';
    document.body.style.overflow = 'auto';
}
function initializeApp() {
    renderCalendar(currentDate);
    setupEventListeners();
    initFloatingLabels();
    initSSE();
    initializeCustomTrips();
    initializeConfirmationModal();
    
    // Set minimum dates on page load
    setMinimumDates();
}
function loadMyBookings() {
    showLoading(true);
    fetch('/my-bookings', {
        headers: {
            'Authorization': `Bearer ${getAuthToken()}`
        }
    })
    .then(res => {
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
    })
    .then(data => {
        console.log('My bookings data:', data); // Debug log
        
        const modal = document.getElementById('myBookingsModal');
        const content = document.getElementById('myBookingsContent');
        
        // Separate completed and active bookings
        const activeRegularBookings = data.regularBookings.filter(booking => !booking.trips?.isCompleted);
        const completedRegularBookings = data.regularBookings.filter(booking => booking.trips?.isCompleted);
        const activeCustomBookings = data.customBookings.filter(booking => !booking.custom_trips?.isCompleted);
        const completedCustomBookings = data.customBookings.filter(booking => booking.custom_trips?.isCompleted);
        
        if (activeRegularBookings.length === 0 && activeCustomBookings.length === 0 && 
            completedRegularBookings.length === 0 && completedCustomBookings.length === 0) {
            content.innerHTML = `
                <div class="no-bookings">
                    <i class="fas fa-calendar-times"></i>
                    <p>لا توجد حجوزات لديك حالياً</p>
                </div>
            `;
        } else {
            content.innerHTML = `
                <div class="my-bookings-container">
                    ${renderBookingsGroup('الرحلات النشطة', activeRegularBookings, activeCustomBookings, false)}
                    ${renderBookingsGroup('الرحلات المكتملة', completedRegularBookings, completedCustomBookings, true)}
                </div>
            `;
            
            // Add event listeners to delete buttons (only for active trips)
            document.querySelectorAll('.delete-booking-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const bookingId = this.dataset.bookingId;
                    const isCustom = this.dataset.isCustom === 'true';
                    deleteBooking(bookingId, isCustom);
                });
            });
        }
        
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    })
    .catch(error => {
        console.error('Error loading bookings:', error);
        showToast('فشل تحميل حجوزاتك', 'error');
    })
    .finally(() => showLoading(false));
}

function renderBookingsGroup(groupTitle, regularBookings, customBookings, isCompleted) {
    const totalBookings = regularBookings.length + customBookings.length;
    
    if (totalBookings === 0) {
        return ''; // Don't show empty sections
    }
    
    const iconClass = isCompleted ? 'fa-check-circle' : 'fa-clock';
    const groupClass = isCompleted ? 'completed-group' : 'active-group';
    
    return `
        <div class="bookings-group ${groupClass}">
            <div class="bookings-group-header">
                <h3>
                    <i class="fas ${iconClass}"></i> 
                    ${groupTitle} 
                    <span class="booking-count-badge">${totalBookings}</span>
                </h3>
                ${isCompleted ? '<p class="group-subtitle"> لا تستطيع إلغاء حجزك من الرحلات المكتملة</p>' : '<p class="group-subtitle">تستطيع إلغاء حجزك من الرحلات النشطة </p>'}
            </div>
            <div class="bookings-group-content">
                ${renderBookingsSection('الرحلات العادية', regularBookings, false, isCompleted)}
                ${renderBookingsSection('الرحلات المخصصة', customBookings, true, isCompleted)}
            </div>
        </div>
    `;
}

function renderBookingsSection(title, bookings, isCustom, isCompletedGroup) {
    if (bookings.length === 0) return '';
    
    return `
        <div class="bookings-section ${isCompletedGroup ? 'completed-section' : 'active-section'}">
            <h4><i class="fas ${isCustom ? 'fa-star' : 'fa-calendar'}"></i> ${title}</h4>
            <div class="bookings-list">
                ${bookings.map(booking => renderBookingItem(booking, isCustom)).join('')}
            </div>
        </div>
    `;
}

function renderBookingItem(booking, isCustom) {
    const trip = isCustom ? booking.custom_trips : booking.trips;
    if (!trip) {
        console.warn('No trip data found for booking:', booking);
        return '';
    }
    
    const tripType = trip.isReturnTrip ? 'عودة' : 'ذهاب';
    const date = trip.isReturnTrip ? trip.returnDate : trip.goDate;
    const time = trip.isReturnTrip ? trip.returnTime : trip.goTime;
    
    // Better project name handling
    let projectDisplay = 'Custom Trip';
    if (!isCustom && trip.projectId) {
        const projectName = trip.projectName || getProjectNameById(trip.projectId) || 'Unknown Project';
        projectDisplay = `المشروع: ${projectName}`;
    }
    
    // Van status handling
    let vanDisplay = '';
    if (trip.vanId) {
        let driverName = null;
        
        if (trip.van && trip.van.driver) {
            driverName = trip.van.driver;
        } else if (trip.driver) {
            driverName = trip.driver;
        } else if (trip.van_driver) {
            driverName = trip.van_driver;
        } else if (typeof trip.van === 'string') {
            driverName = trip.van;
        }
        
        if (driverName && driverName !== 'Driver assigned') {
            vanDisplay = `<p><i class="fas fa-van-shuttle"></i> السائق: ${driverName}</p>`;
        } else {
            vanDisplay = `<p><i class="fas fa-van-shuttle"></i> <span style="color: #999;">Driver assigned (name not available)</span></p>`;
        }
    } else {
        vanDisplay = `<p><i class="fas fa-van-shuttle"></i> <span style="color: #999;">لم يتم تخصيص فان بعد</span></p>`;
    }
    
    return `
        <div class="booking-item ${trip.isCompleted ? 'completed' : 'active'}">
            <div class="booking-status-indicator ${trip.isCompleted ? 'completed' : 'active'}"></div>
            <div class="booking-content">
                <div class="booking-header">
                    <h4>
                        <i class="fas ${trip.isReturnTrip ? 'fa-arrow-left' : 'fa-arrow-right'}"></i>
                        ${trip.destination} (${tripType})
                        ${trip.isCompleted ? '<span class="trip-status-pill completed">COMPLETED</span>' : '<span class="trip-status-pill active">ACTIVE</span>'}
                    </h4>
                    ${!trip.isCompleted ? `
                        <button class="delete-booking-btn" 
                                data-booking-id="${booking.id}" 
                                data-is-custom="${isCustom}"
                                title="Cancel this booking">
                            <i class="fas fa-trash"></i>
                            <span>إلغاء</span>
                        </button>
                    ` : ''}
                </div>
                <div class="booking-details">
                    <p><i class="fas fa-calendar-day"></i> ${date} at ${time}</p>
                    <p><i class="fas fa-briefcase"></i> ${projectDisplay}</p>
                    ${vanDisplay}
                </div>
                ${trip.isCompleted ? `
                    <div class="booking-completion-info">
                        <i class="fas fa-check-circle"></i>
                        <span>هذه الرحلة مكتملة ولا يمكن إلغاء الحجز فيها</span>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}
function renderBookingsSection(title, bookings, isCustom) {
    if (bookings.length === 0) return '';
    
    return `
        <div class="bookings-section">
            <h3><i class="fas ${isCustom ? 'fa-star' : 'fa-calendar'}"></i> ${title}</h3>
            <div class="bookings-list">
                ${bookings.map(booking => renderBookingItem(booking, isCustom)).join('')}
            </div>
        </div>
    `;
}

function renderBookingItem(booking, isCustom) {
    const trip = isCustom ? booking.custom_trips : booking.trips;
    if (!trip) {
        console.warn('No trip data found for booking:', booking);
        return '';
    }
    
    const tripType = trip.isReturnTrip ? 'عودة' : 'ذهاب';
    const date = trip.isReturnTrip ? trip.returnDate : trip.goDate;
    const time = trip.isReturnTrip ? trip.returnTime : trip.goTime;
    
    // FIXED: Better project name handling
    let projectDisplay = 'Custom Trip';
    if (!isCustom && trip.projectId) {
        // For regular trips, get project name from the projects data or trip data
        const projectName = trip.projectName || getProjectNameById(trip.projectId) || 'Unknown Project';
        projectDisplay = `المشروع: ${projectName}`;
    }
    
    // FIXED: Better van status handling with proper driver name extraction
    let vanDisplay = '';
    if (trip.vanId) {
        // Try multiple ways to get the driver name
        let driverName = null;
        
        // Method 1: Check if trip has van object with driver
        if (trip.van && trip.van.driver) {
            driverName = trip.van.driver;
        }
        // Method 2: Check if trip has direct driver property
        else if (trip.driver) {
            driverName = trip.driver;
        }
        // Method 3: Check if trip has van_driver property
        else if (trip.van_driver) {
            driverName = trip.van_driver;
        }
        // Method 4: Check if trip.van is a string (driver name)
        else if (typeof trip.van === 'string') {
            driverName = trip.van;
        }
        
        if (driverName && driverName !== 'Driver assigned') {
            vanDisplay = `<p><i class="fas fa-van-shuttle"></i> السائق: ${driverName}</p>`;
        } else {
            vanDisplay = `<p><i class="fas fa-van-shuttle"></i> <span style="color: #999;">Driver assigned (name not available)</span></p>`;
        }
    } else {
        vanDisplay = `<p><i class="fas fa-van-shuttle"></i> <span style="color: #999;">لم يتم تخصيص فان بعد</span></p>`;
    }
    
    return `
        <div class="booking-item ${trip.isCompleted ? 'completed' : ''}">
            <div class="booking-header">
                <h4>
                    <i class="fas ${trip.isReturnTrip ? 'fa-arrow-left' : 'fa-arrow-right'}"></i>
                    ${trip.destination} (${tripType})
                </h4>
                ${!trip.isCompleted ? `
                    <button class="delete-booking-btn" 
                            data-booking-id="${booking.id}" 
                            data-is-custom="${isCustom}">
                        <i class="fas fa-trash"></i> إلغاء الحجز
                    </button>
                ` : ''}
            </div>
            <div class="booking-details">
<p>
  <strong>📅التاريخ:</strong> ${date} &nbsp;  &nbsp; 
</p>
<p>
<i class="fas fa-briefcase"></i> ${projectDisplay}
</p>   
<p>  <strong>⏰الساعة:</strong> ${time}
</p>           
                ${vanDisplay}
            </div>
            ${trip.isCompleted ? `

            ` : ''}
        </div>
    `;
}
function getProjectNameById(projectId) {
    if (!window.projectsData || !projectId) return null;
    
    const project = window.projectsData.find(p => p.id.toString() === projectId.toString());
    return project ? project.name : null;
}
function deleteBooking(bookingId, isCustom) {
    if (!confirm('Are you sure you want to cancel this booking?')) return;
    
    // Additional check: Prevent deletion of completed trips
    const bookingElement = document.querySelector(`[data-booking-id="${bookingId}"]`);
    if (bookingElement && bookingElement.closest('.booking-item').classList.contains('completed')) {
        showToast('لا يمكنك الغاء الحجز من الرحلات المكتملة', 'error');
        return;
    }
    
    showLoading(true);
    fetch(`/delete-booking/${bookingId}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({ isCustom })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            showToast('تم الغاء الحجز بنجاح', 'success');
            loadMyBookings(); // Refresh the list
        } else {
            throw new Error(data.error || 'Failed to cancel booking');
        }
    })
    .catch(error => {
        console.error('Error deleting booking:', error);
        showToast(error.message || 'فشل الغاء الحجز', 'error');
    })
    .finally(() => showLoading(false));
}
    function resetTripSelection() {
        if (!isProjectLocked) {
            projectSelect.disabled = false;
            projectLockMessage.style.display = 'none';
            document.getElementById('goTime').disabled = false;
            document.getElementById('returnTime').disabled = false;
            timeWarningEl.style.display = 'none';
            returnTimeWarningEl.style.display = 'none';
        }
    }

    function clearDateFields() {
        document.getElementById('goDate').value = '';
        document.getElementById('returnDate').value = '';
        document.getElementById('goTime').value = '';
        document.getElementById('returnTime').value = '';
        
        // Also reset the warnings and enable time inputs
        timeWarningEl.style.display = 'none';
        returnTimeWarningEl.style.display = 'none';
        document.getElementById('goTime').disabled = false;
        document.getElementById('returnTime').disabled = false;
        
        // Only unlock project if it wasn't locked by the other trip
        if (!document.getElementById('goTime').disabled || !document.getElementById('returnTime').disabled) {
            projectSelect.disabled = false;
            projectLockMessage.style.display = 'none';
            isProjectLocked = false;
        }
    }

    function initFloatingLabels() {
        document.querySelectorAll('.floating-input').forEach(input => {
            if (input.value) {
                input.nextElementSibling.classList.add('active');
            }
            
            input.addEventListener('focus', function() {
                this.nextElementSibling.classList.add('active');
            });
            
            input.addEventListener('blur', function() {
                if (!this.value) {
                    this.nextElementSibling.classList.remove('active');
                }
            });
        });
    }

function validateTimes() {
    const goDate = document.getElementById('goDate').value;
    const returnDate = document.getElementById('returnDate').value;
    const goTime = document.getElementById('goTime').value;
    const returnTime = document.getElementById('returnTime').value;
    
    // Check if dates are not in the past
    const today = new Date().toISOString().split('T')[0];
    
    if (goDate && goDate < today) {
        showToast('تاريخ الذهاب لا يمكن ان يكون في الماضي', 'error');
        document.getElementById('goDate').value = '';
        return false;
    }
    
    if (returnDate && returnDate < today) {
        showToast('تاريخ العودة لا يمكن ان يكون في الماضي', 'error');
        document.getElementById('returnDate').value = '';
        return false;
    }
    
    // Existing same-day time validation
    if (goDate === returnDate && goTime && returnTime) {
        if (returnTime <= goTime) {
            showToast('وقت الاياب يجب ان يكون بعد وقت الذهاب من اجل الرحلات التي تقع في نفس اليوم', 'error');
            document.getElementById('returnTime').value = '';
            return false;
        }
    }
    return true;
}

    function validateReturnDate() {
        const goDateInput = document.getElementById('goDate');
        const returnDateInput = document.getElementById('returnDate');
        
        if (goDateInput.value && returnDateInput.value) {
            const goDate = new Date(goDateInput.value);
            const returnDate = new Date(returnDateInput.value);
            
            if (returnDate < goDate) {
                showToast('تاريخ العودة لا يمكن ان يكون قبل تاريخ الذهاب', 'error');
                returnDateInput.value = goDateInput.value;
                validateTimes();
            }
        }
    }

   // Updated checkExistingTimes function
function checkExistingTimes() {
    const destination = destinationSelect.value;
    const goDate = document.getElementById('goDate').value;
    
    if (destination && goDate) {
        showLoading(true);
        fetch(`/check-trip?destination=${encodeURIComponent(destination)}&date=${goDate}&isReturn=false`)
            .then(res => res.json())
            .then(result => {
                if (result.hasExistingTrip && !result.isFull && result.canSetOwnTime) {
                    // Join existing trip with flexible time
                    isProjectLocked = true;
                    timeWarningEl.className = 'time-warning info';
                    timeWarningEl.innerHTML = `
                        <i class="fas fa-info-circle"></i>
                        <div>
                            <strong> انضم لرحلة موجودة مسبقاً الى ${destination}</strong><br>
                            <small>التوقيت الحالي للذهاب: ${result.currentTime}</small><br>
                            <small>المشروع: ${result.projectName} (${result.remainingCapacity} مقاعد متبقية)</small><br>
                            <em style="color: #666; font-size: 0.9em;">
                                                   💡 إذا اخترت توقيت قبل الساعة ${result.currentTime}, فإن توقيت الذهاب سيتم تحديثه الى الوقت الذي قمت باختياره

                            </em>
                        </div>
                    `;
                    timeWarningEl.style.display = 'flex';
                    
                    // Don't auto-fill time, let user choose their preferred time
                    document.getElementById('goTime').disabled = false;
                    document.getElementById('goTime').value = '';
                    document.getElementById('goTime').placeholder = `Current: ${result.currentTime} (you can choose earlier)`;
                    
                    projectSelect.value = result.projectId;
                    projectSelect.disabled = true;
                    projectLockMessage.style.display = 'block';
                    selectedProjectName = result.projectName;
                } else if (result.isFull) {
                    // Handle full trips
                    timeWarningEl.className = 'time-warning warning';
                    timeWarningEl.innerHTML = `
                        <i class="fas fa-exclamation-triangle"></i>
                        <span>${result.message}</span>
                        <div style="margin-top: 0.5rem; font-size: 0.9em;">
                            <i class="fas fa-info-circle"></i> A new trip will be created if you proceed
                        </div>
                    `;
                    timeWarningEl.style.display = 'flex';
                    
                    document.getElementById('goTime').disabled = false;
                    document.getElementById('goTime').value = '';
                    document.getElementById('goTime').placeholder = '';
                    
                    if (!document.getElementById('returnTime').disabled) {
                        projectSelect.disabled = false;
                        projectLockMessage.style.display = 'none';
                        isProjectLocked = false;
                    }
                } else {
                    // No existing trip - first booking
                    timeWarningEl.style.display = 'none';
                    document.getElementById('goTime').disabled = false;
                    document.getElementById('goTime').value = '';
                    document.getElementById('goTime').placeholder = '';
                    
                    if (!document.getElementById('returnTime').disabled) {
                        projectSelect.disabled = false;
                        projectLockMessage.style.display = 'none';
                        isProjectLocked = false;
                    }
                }
            })
            .catch(() => showToast('Failed to check trip availability', 'error'))
            .finally(() => showLoading(false));
    }
}

 function checkReturnTimes() {
    const destination = destinationSelect.value;
    const returnDate = document.getElementById('returnDate').value;
    
    if (destination && returnDate) {
        showLoading(true);
        fetch(`/check-trip?destination=${encodeURIComponent(destination)}&date=${returnDate}&isReturn=true`)
            .then(res => res.json())
            .then(result => {
                if (result.hasExistingTrip && !result.isFull && result.canSetOwnTime) {
                    // Join existing return trip with flexible time
                    isProjectLocked = true;
                    returnTimeWarningEl.className = 'time-warning info';
                    returnTimeWarningEl.innerHTML = `
                        <i class="fas fa-info-circle"></i>
                        <div>
                            <strong>انضم لرحلة موجودة مسبقاً من ${destination}</strong><br>
                            <small>التوقيت الحالي للعودة: ${result.currentTime}</small><br>
                            <small>المشروع: ${result.projectName} (${result.remainingCapacity} مقاعد متبقية)</small><br>
                            <em style="color: #666; font-size: 0.9em;">
                                                                                 💡 إذا اخترت توقيت بعد الساعة ${result.currentTime}, فإن توقيت العودة سيتم تحديثه الى الوقت الذي قمت باختياره

                            </em>
                        </div>
                    `;
                    returnTimeWarningEl.style.display = 'flex';
                    
                    // Don't auto-fill time, let user choose their preferred time
                    document.getElementById('returnTime').disabled = false;
                    document.getElementById('returnTime').value = '';
                    document.getElementById('returnTime').placeholder = `Current: ${result.currentTime} (you can choose later)`;
                    
                    projectSelect.value = result.projectId;
                    projectSelect.disabled = true;
                    projectLockMessage.style.display = 'block';
                    selectedProjectName = result.projectName;
                } else if (result.isFull) {
                    // Handle full trips
                    returnTimeWarningEl.className = 'time-warning warning';
                    returnTimeWarningEl.innerHTML = `
                        <i class="fas fa-exclamation-triangle"></i>
                        <span>${result.message}</span>
                        <div style="margin-top: 0.5rem; font-size: 0.9em;">
                            <i class="fas fa-info-circle"></i> A new return trip will be created if you proceed
                        </div>
                    `;
                    returnTimeWarningEl.style.display = 'flex';
                    
                    document.getElementById('returnTime').disabled = false;
                    document.getElementById('returnTime').value = '';
                    document.getElementById('returnTime').placeholder = '';
                    
                    if (!document.getElementById('goTime').disabled) {
                        projectSelect.disabled = false;
                        projectLockMessage.style.display = 'none';
                        isProjectLocked = false;
                    }
                } else {
                    // No existing return trip
                    returnTimeWarningEl.style.display = 'none';
                    document.getElementById('returnTime').disabled = false;
                    document.getElementById('returnTime').value = '';
                    document.getElementById('returnTime').placeholder = '';
                    
                    if (!document.getElementById('goTime').disabled) {
                        projectSelect.disabled = false;
                        projectLockMessage.style.display = 'none';
                        isProjectLocked = false;
                    }
                }
            })
            .catch(() => showToast('Failed to check return trip availability', 'error'))
            .finally(() => showLoading(false));
    }
}
// Add this function after the checkReturnTimes function in script.js
function checkExistingCustomTrips() {
    const customDestination = document.getElementById('customDestination').value;
    const goDate = document.getElementById('goDate').value;
    const returnDate = document.getElementById('returnDate').value;
    
    if (customDestination && customDestination.trim() !== '' && goDate && returnDate) {
        showLoading(true);
        fetch(`/check-custom-trip?destination=${encodeURIComponent(customDestination.trim())}&goDate=${goDate}&returnDate=${returnDate}`)
            .then(res => res.json())
            .then(result => {
                const timeWarning = document.getElementById('timeWarning');
                const returnTimeWarning = document.getElementById('returnTimeWarning');
                
                if (result.hasExistingTrips) {
                    // Display information about existing trips
                    let warningMessage = '<i class="fas fa-info-circle"></i><div>';
                    warningMessage += `<strong>Existing trips found to ${customDestination}</strong><br>`;
                    
                    if (result.departureTrip) {
                        warningMessage += `<small>Departure: ${result.departureTrip.goDate} at ${result.departureTrip.goTime} (${result.departureTrip.availableSeats} seats left)</small><br>`;
                    }
                    
                    if (result.returnTrip) {
                        warningMessage += `<small>Return: ${result.returnTrip.returnDate} at ${result.returnTrip.returnTime} (${result.returnTrip.availableSeats} seats left)</small><br>`;
                    }
                    
                    warningMessage += '<em style="color: #666; font-size: 0.9em;">You will be added to these existing trips.</em>';
                    warningMessage += '</div>';
                    
                    timeWarning.className = 'time-warning info';
                    timeWarning.innerHTML = warningMessage;
                    timeWarning.style.display = 'flex';
                    
                    // Auto-fill the times from existing trips
                    if (result.departureTrip) {
                        document.getElementById('goTime').value = result.departureTrip.goTime;
                        document.getElementById('goTime').disabled = true;
                    }
                    
                    if (result.returnTrip) {
                        document.getElementById('returnTime').value = result.returnTrip.returnTime;
                        document.getElementById('returnTime').disabled = true;
                    }
                } else {
                    // No existing trips - clear warnings
                    timeWarning.style.display = 'none';
                    returnTimeWarning.style.display = 'none';
                    document.getElementById('goTime').disabled = false;
                    document.getElementById('returnTime').disabled = false;
                    document.getElementById('goTime').value = '';
                    document.getElementById('returnTime').value = '';
                }
            })
            .catch(() => showToast('Failed to check existing custom trips', 'error'))
            .finally(() => showLoading(false));
    }
}

    function updateMonth(monthDelta) {
        currentDate.setMonth(currentDate.getMonth() + monthDelta);
        renderCalendar(currentDate);
    }

    function renderCalendar(date) {
        const year = date.getFullYear();
        const month = date.getMonth();
        currentMonthEl.textContent = `${date.toLocaleString('default', { month: 'long' })} ${year}`;
        
        calendarEl.innerHTML = '';
        createDayHeaders();
        
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const prevMonthDays = new Date(year, month, 0).getDate();

        // Previous month days
        for (let i = firstDay - 1; i >= 0; i--) {
            createDayElement(prevMonthDays - i, true);
        }

        // Current month days
        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = formatDate(year, month + 1, i);
            createDayElement(i, false, dateStr);
        }

        // Next month days
        const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
        for (let i = 1; i <= (totalCells - (firstDay + daysInMonth)); i++) {
            createDayElement(i, true);
        }
    }

    function createDayHeaders() {
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
            const header = document.createElement('div');
            header.className = 'calendar-header-day';
            header.textContent = day;
            calendarEl.appendChild(header);
        });
    }

    function createDayElement(dayNum, isOtherMonth, dateStr = '') {
        const dayEl = document.createElement('div');
        dayEl.className = `day ${isOtherMonth ? 'other-month' : ''}`;
        
        const dayNumberEl = document.createElement('div');
        dayNumberEl.className = 'day-number';
        dayNumberEl.textContent = dayNum;
        dayEl.appendChild(dayNumberEl);

        if (!isOtherMonth && dateStr) {
            fetchBookingsForDate(dateStr, dayEl);
        }
        
        calendarEl.appendChild(dayEl);
    }

 function fetchBookingsForDate(dateStr, dayEl) {
    // Check cache first
    if (cachedBookingsData.has(dateStr)) {
        const trips = cachedBookingsData.get(dateStr);
        renderDayBookings(trips, dayEl, dateStr);
        return Promise.resolve(trips);
    }

    showLoading(true, dayEl);
    
    // Add excludeCompleted parameter for dashboard view
    // This endpoint now only returns regular trips, not custom trips
    const url = `/bookings/${dateStr}?excludeCompleted=true`;
    
    return fetch(url)
        .then(res => res.json())
        .then(trips => {
            // Additional client-side filtering to ensure completed trips are excluded
            // and that we're only dealing with regular trips (backend already filters custom trips out)
            const activeRegularTrips = trips.filter(trip => !trip.isCompleted);
            
            // Cache the filtered data
            cachedBookingsData.set(dateStr, activeRegularTrips);
            renderDayBookings(activeRegularTrips, dayEl, dateStr);
            
            return activeRegularTrips;
        })
        .catch(() => {
            showToast('Failed to load bookings for this date', 'error');
            return [];
        })
        .finally(() => showLoading(false, dayEl));
}

function renderDayBookings(trips, dayEl, dateStr) {
    // This function now only renders regular trips on the calendar
    // Custom trips are handled separately in the sidebar
    if (trips.length > 0) {
        dayEl.classList.add('has-bookings');
        
        const detailsEl = document.createElement('div');
        detailsEl.className = 'day-bookings';
        
        trips.forEach(trip => {
            const journeyEl = document.createElement('div');
            // Add closed-trip class if the trip is closed
            const closedClass = trip.isClosed ? 'closed-trip' : '';
            journeyEl.className = `day-journey ${trip.isReturnTrip ? 'return-trip' : 'departure-trip'} ${trip.isCompleted ? 'completed-trip' : ''} ${closedClass}`;
            journeyEl.innerHTML = `
                <div class="journey-van">${trip.vanId ? `السائق: ${trip.driver}` : 'لم يتم تخصيص فان'}</div>
                <div class="journey-project">${trip.projectName}</div>
                <div class="journey-destination">${trip.destination}</div>
                <div class="journey-time">${trip.time} ${trip.isReturnTrip ? '(Return)' : '(Departure)'}</div>
                <div class="passenger-count">${trip.passengerCount} ركاب</div>
            `;
            detailsEl.appendChild(journeyEl);
        });

        dayEl.appendChild(detailsEl);
        
        const countEl = document.createElement('div');
        countEl.className = 'booking-count';
        countEl.textContent = trips.length;
        dayEl.appendChild(countEl);
        
        dayEl.addEventListener('click', (e) => {
            showBookings(dateStr, trips);
        });
    }
}

// In script.js - Update the fetchBookingsForDate function to only handle regular trips:

function fetchBookingsForDate(dateStr, dayEl) {
    // Check cache first
    if (cachedBookingsData.has(dateStr)) {
        const trips = cachedBookingsData.get(dateStr);
        renderDayBookings(trips, dayEl, dateStr);
        return Promise.resolve(trips);
    }

    showLoading(true, dayEl);
    
    // Add excludeCompleted parameter for dashboard view
    // This endpoint now only returns regular trips, not custom trips
    const url = `/bookings/${dateStr}?excludeCompleted=true`;
    
    return fetch(url)
        .then(res => res.json())
        .then(trips => {
            // Additional client-side filtering to ensure completed trips are excluded
            // and that we're only dealing with regular trips (backend already filters custom trips out)
            const activeRegularTrips = trips.filter(trip => !trip.isCompleted);
            
            // Cache the filtered data
            cachedBookingsData.set(dateStr, activeRegularTrips);
            renderDayBookings(activeRegularTrips, dayEl, dateStr);
            
            return activeRegularTrips;
        })
        .catch(() => {
            showToast('Failed to load bookings for this date', 'error');
            return [];
        })
        .finally(() => showLoading(false, dayEl));
}

// Update the renderDayBookings function to add a comment for clarity
function renderDayBookings(trips, dayEl, dateStr) {
    // This function now only renders regular trips on the calendar
    // Custom trips are handled separately in the sidebar
    if (trips.length > 0) {
        dayEl.classList.add('has-bookings');
        
        const detailsEl = document.createElement('div');
        detailsEl.className = 'day-bookings';
        
        trips.forEach(trip => {
            const journeyEl = document.createElement('div');
            // Add closed-trip class if the trip is closed
            const closedClass = trip.isClosed ? 'closed-trip' : '';
            journeyEl.className = `day-journey ${trip.isReturnTrip ? 'return-trip' : 'departure-trip'} ${trip.isCompleted ? 'completed-trip' : ''} ${closedClass}`;
            journeyEl.innerHTML = `
                <div class="journey-van">${trip.vanId ? `السائق: ${trip.driver}` : 'لم يتم تخصيص فان'}</div>
                <div class="journey-project">${trip.projectName}</div>
                <div class="journey-destination">${trip.destination}</div>
                <div class="journey-time">${trip.time} ${trip.isReturnTrip ? '(Return)' : '(Departure)'}</div>
                <div class="passenger-count">${trip.passengerCount} ركاب</div>
            `;
            detailsEl.appendChild(journeyEl);
        });

        dayEl.appendChild(detailsEl);
        
        const countEl = document.createElement('div');
        countEl.className = 'booking-count';
        countEl.textContent = trips.length;
        dayEl.appendChild(countEl);
        
        dayEl.addEventListener('click', (e) => {
            showBookings(dateStr, trips);
        });
    }
}

// Update the showBookings function to clarify it's for regular trips only
function showBookings(dateStr, trips) {
    modalDateEl.textContent = `رحلات يوم ${new Date(dateStr).toLocaleDateString('ar-SY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;
modalDateEl.style.paddingTop = '24px'; // Add this line

    bookingDetailsEl.innerHTML = trips.map(trip => `
        <div class="booking-item ${trip.isReturnTrip ? 'return' : 'departure'} ${trip.isCompleted ? 'completed' : ''} ${trip.isClosed ? 'closed' : ''}" 
             data-destination="${trip.destination}" 
             data-project-name="${trip.projectName}"
             data-trip-time="${trip.time}"
             data-is-return="${trip.isReturnTrip}"
             data-driver="${trip.driver || ''}"
             data-van-id="${trip.vanId || ''}">
            <h4>
                <i class="fas ${trip.isReturnTrip ? 'fa-arrow-left' : 'fa-arrow-right'}"></i> 
                ${trip.vanId ? `السائق: ${trip.driver}` : 'لم يتم تخصيص فان بعد لرحلة'}  ${trip.destination}
                ${trip.isCompleted ? '<span class="trip-status-badge">Completed</span>' : ''}
                ${trip.isClosed ? '<span class="trip-status-badge" style="background: var(--danger);">Closed</span>' : ''}
            </h4>
            <p><i class="fas fa-briefcase"></i> المشروع: ${trip.projectName}</p>
            <p><i class="fas fa-clock"></i> ${trip.isReturnTrip ? 'ساعة العودة' : 'ساعة الذهاب'}: ${trip.time}</p>
            <div class="passengers">
                <span class="passenger-count" data-current-count="${trip.passengerCount}">${trip.passengerCount} ركاب</span>
                <span class="passenger-count">${8 - trip.passengerCount} مقاعد متوفرة</span>
            </div>
            ${!trip.isCompleted && !trip.isClosed ? `
            <button class="btn enroll-btn" data-trip-id="${trip.tripId}" 
                style="margin-top: 0.5rem; background: ${trip.passengerCount >= 8 ? 'var(--gray)' : 'var(--primary)'}" 
                ${trip.passengerCount >= 8 ? 'disabled' : ''}>
                <i class="fas fa-user-plus"></i> ${trip.passengerCount >= 8 ? 'Trip Full' : 'انضمام'}
            </button>
            ${trip.passengerCount >= 8 ? '<p class="trip-full-message" style="color: var(--danger); margin-top: 0.5rem;">Sorry, this trip is full. Please create a new one using the form.</p>' : ''}
            ` : ''}
            ${trip.isClosed ? '<p class="trip-full-message" style="color: var(--danger); margin-top: 0.5rem;">This trip is closed. No new enrollments allowed.</p>' : ''}
        </div>
    `).join('');
    
    // Add event listeners to enroll buttons
    bookingDetailsEl.querySelectorAll('.enroll-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            enrollInTrip(this.dataset.tripId);
        });
    });
    
    bookingsModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}
 function enrollInTrip(tripId) {
    // Find the booking item
    const bookingItem = document.querySelector(`[data-trip-id="${tripId}"]`).closest('.booking-item');
    
    // Extract trip data
    let destination = bookingItem.getAttribute('data-destination');
    
    if (!destination) {
        const headerText = bookingItem.querySelector('h4').textContent;
        let destinationMatch = headerText.match(/to\s+(.+?)(?:\s|$)/);
        if (!destinationMatch) {
            destinationMatch = headerText.match(/→\s*(.+?)(?:\s|$)/);
        }
        destination = destinationMatch ? destinationMatch[1].trim() : 'Unknown Destination';
    }
    
    const headerText = bookingItem.querySelector('h4').textContent;
    const projectText = bookingItem.querySelector('p').textContent;
    const timeText = bookingItem.querySelector('p:nth-child(3)').textContent;
    const passengerCountText = bookingItem.querySelector('.passenger-count').textContent;
    
    const tripData = {
        destination: destination,
        projectName: projectText.replace('المشروع: ', '').trim(),
        time: timeText,
        passengerCount: parseInt(passengerCountText.match(/\d+/)?.[0] || '0'),
        isReturnTrip: bookingItem.classList.contains('return'),
        driver: headerText.match(/السائق:\s*(.+?)\s+to/)?.[1] || null,
        vanId: headerText.includes('السائق:')
    };

    // Show time input dialog instead of direct confirmation
    showTripTimeInputDialog(tripId, tripData);
}
function showTripTimeInputDialog(tripId, tripData) {
    const modal = document.getElementById('confirmationModal');
    const title = document.getElementById('confirmationTitle');
    const message = document.getElementById('confirmationMessage');
    
    const tripType = tripData.isReturnTrip ? 'عودة' : 'ذهاب';
    const timeLabel = tripData.isReturnTrip ? 'return time' : 'departure time';
    const currentTime = tripData.time;
    
    title.textContent = `تسطيع تحديد وقتك المفضل للرحلة`;
    
    message.innerHTML = `
        <div class="trip-details">
            <div class="trip-detail-item">
                <i class="fas fa-map-marker-alt"></i>
                <span>الوجهة: ${tripData.destination}</span>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-briefcase"></i>
                <span>المشروع: ${tripData.projectName}</span>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-clock"></i>
                <span> ${currentTime}</span>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-users"></i>
                <span>المقاعد المتوفرة: ${8 - tripData.passengerCount}/8</span>
            </div>
        </div>
        
        <div class="time-input-section" dir="rtl" style="margin: 20px 0; direction: rtl; padding: 15px; background: #f8f9fa; border-radius: 8px;">
            <label for="preferredTime" dir="rtl" style="display: block; direction: rtl; margin-bottom: 8px; font-weight: bold">
                <i class="fas fa-clock"></i> اختر توقيتك المفضل للرحلة:
            </label>
            <input type="time" id="preferredTime" value="${currentTime}" 
                   style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px;">
            <div class="time-help-text" style="margin-top: 8px; font-size: 14px; color: #666;">
                ${tripData.isReturnTrip ? 
                    `💡 إذا اخترت توقيت بعد الساعة ${currentTime}, فإن توقيت العودة سيتم تحديثه الى الوقت الذي قمت باختياره` :
                    `💡 إذا اخترت توقيت قبل الساعة ${currentTime}, فإن توقيت الذهاب سيتم تحديثه الى الوقت الذي قمت باختياره`
                }
            </div>
        </div>
        
    `;

    // Store enrollment data
    pendingEnrollment = {
        type: 'regular-with-time',
        tripId: tripId,
        tripData: tripData
    };

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function showTripTimeInputDialog(tripId, tripData) {
    const modal = document.getElementById('confirmationModal');
    const title = document.getElementById('confirmationTitle');
    const message = document.getElementById('confirmationMessage');
    
    const tripType = tripData.isReturnTrip ? 'عودة' : 'ذهاب';
    const timeLabel = tripData.isReturnTrip ? 'return time' : 'departure time';
    const currentTime = tripData.time;
    
    title.textContent = `تستطيع ادخال وقتك المفضل للرحلة`;
    
    message.innerHTML = `
        <div class="trip-details">
            <div class="trip-detail-item">
                <i class="fas fa-map-marker-alt"></i>
                <span>الوجهة: ${tripData.destination}</span>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-briefcase"></i>
                <span>المشروع: ${tripData.projectName}</span>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-clock"></i>
                <span> ${currentTime}</span>
            </div>
            <div class="trip-detail-item">
                <i class="fas fa-users"></i>
                <span>المقاعد المتوفرة: ${8 - tripData.passengerCount}/8</span>
            </div>
        </div>
        
        <div class="time-input-section" dir="rtl" style="margin: 20px 0; direction: rtl; padding: 15px; background: #f8f9fa; border-radius: 8px;">
            <label for="preferredTime" dir="rtl" style="display: block; direction: rtl; margin-bottom: 8px; font-weight: bold;">
                <i class="fas fa-clock" ></i> اختر توقيتك المفضل للرحلة:
            </label>
            <input type="time" id="preferredTime" value="${currentTime}" 
                   style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px;">
            <div class="time-help-text" style="margin-top: 8px; font-size: 14px; color: #666;">
                ${tripData.isReturnTrip ? 
                    `💡 إذا اخترت توقيت بعد  ${currentTime} الحالية, فإن توقيت العودة سيتم تحديثه الى الوقت الذي قمت باختياره` :
                    `💡 إذا اخترت توقيت قبل  ${currentTime} الحالية, فإن توقيت الذهاب سيتم تحديثه الى الوقت الذي قمت باختياره`

                }
            </div>
        </div>
        
    `;

    // Store enrollment data
    pendingEnrollment = {
        type: 'regular-with-time',
        tripId: tripId,
        tripData: tripData
    };

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}
    function closeModal() {
        bookingModal.style.display = 'none';
        bookingsModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }

// Update your handleBookingSubmit function to include final date validation
function handleBookingSubmit(e) {
    e.preventDefault();
    
    // Get the submit button and prevent double submission
    const submitButton = bookingForm.querySelector('button[type="submit"]');
    const originalText = submitButton.innerHTML;
    
    // Check if already submitting
    if (submitButton.disabled) {
        return;
    }
    
    // Check if this is a custom destination booking
    const destinationSelect = document.getElementById('destination');
    const isCustomDestination = destinationSelect.value === 'custom';
    
    if (isCustomDestination) {
        handleCustomBookingSubmit(e);
        return;
    }
    
    // Disable the submit button immediately
    submitButton.disabled = true;
    submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارٍ الحجز';
    
    // Final validation including past dates
    if (!validateTimes()) {
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
        return;
    }
    
    // Additional validation for required fields
    const goDate = document.getElementById('goDate').value;
    const returnDate = document.getElementById('returnDate').value;
    
    if (!goDate && !returnDate) {
        showToast('Please select at least one date (departure or return)', 'error');
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
        return;
    }
    
    // Rest of your existing booking logic...
    const formData = new FormData(bookingForm);
    const data = Object.fromEntries(formData.entries());
    data.email = 'user@drd-me.org';

    if (!data.projectId && projectSelect.value) {
        data.projectId = projectSelect.value;
    }

    if (!data.projectId || data.projectId === '') {
        showToast('اختر مشروعا من فضلك!', 'error');
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
        return;
    }
    delete data.name;

    showLoading(true);
    fetch('/book', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify(data)
    })
    .then(res => {
        if (!res.ok) {
            throw new Error('Network response was not ok');
        }
        return res.json();
    })
    .then(result => {
        if (result.success) {
            let message = '🎉 ،تم الحجز بنجاح ';
            
            result.bookings.forEach(booking => {
                const tripType = booking.isReturnTrip ? 'عودة' : 'ذهاب';
                const action = booking.isNew ? 'تم فتح ' : 'تم حجز';
                message += `${action} رحلة ${tripType}   `;
                
                if (booking.timeUpdated) {
                    const direction = booking.isReturnTrip ? 'updated to later time' : 'updated to earlier time';
                    message += `⏰ Trip time ${direction}: ${booking.newTime}. `;
                }
            });
            
            showToast(message, 'success');
            
            bookingForm.reset();
            if (isProjectLocked) {
                projectSelect.value = data.projectId;
                projectSelect.disabled = true;
            }
            
            cachedBookingsData.clear();
            closeModal();
            
            // Reset minimum dates after form reset
            setTimeout(() => {
                setMinimumDates();
                if (isProjectLocked) {
                    projectSelect.value = data.projectId;
                    projectSelect.disabled = true;
                }
            }, 100);
            
            setTimeout(() => {
                isProjectLocked = false;
            }, 1500);
        } else if (result.error) {
            showToast(result.error, 'error');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showToast('فشل الحجز، حدث الصفحة وحاول ثانيةً.', 'error');
    })
    .finally(() => {
        // Always re-enable the button in finally block
        submitButton.disabled = false;
        submitButton.innerHTML = originalText;
        showLoading(false);
    });
}
function getAuthToken() {
    // Get token from cookie
    const cookieValue = document.cookie
        .split('; ')
        .find(row => row.startsWith('sb-access-token='))
        ?.split('=')[1];
    
    return cookieValue || '';
}
    function showToast(message, type) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-times-circle' : 'fa-exclamation-circle'}"></i>
            <span>${message}</span>
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease-out';
            toast.addEventListener('animationend', () => toast.remove());
        }, 3000);
    }

    function showLoading(show, element = document.body) {
        const loaderId = 'loading-spinner';
        
        if (show) {
            // Remove any existing spinner first to avoid duplicates
            const existingLoader = element.querySelector(`#${loaderId}`);
            if (existingLoader) {
                existingLoader.remove();
            }
            
            const loader = document.createElement('div');
            loader.className = 'spinner';
            loader.id = loaderId;
            
            if (element === document.body) {
                loader.style.position = 'fixed';
                loader.style.top = '50%';
                loader.style.left = '50%';
                loader.style.transform = 'translate(-50%, -50%)';
                loader.style.zIndex = '9999';
                loader.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
                loader.style.padding = '20px';
                loader.style.borderRadius = '8px';
                loader.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.1)';
            }
            
            element.appendChild(loader);
            element.style.position = 'relative';
            
            // Store reference for cleanup
            element._loadingSpinner = loader;
        } else {
            // Multiple cleanup strategies to ensure spinner is removed
            
            // Strategy 1: Use stored reference
            if (element._loadingSpinner) {
                element._loadingSpinner.remove();
                delete element._loadingSpinner;
            }
            
            // Strategy 2: Find by ID
            const loaderById = element.querySelector(`#${loaderId}`);
            if (loaderById) {
                loaderById.remove();
            }
            
            // Strategy 3: Find by class (fallback)
            const loaderByClass = element.querySelector('.spinner');
            if (loaderByClass) {
                loaderByClass.remove();
            }
            
            // Strategy 4: Remove all spinners in the element (nuclear option)
            const allSpinners = element.querySelectorAll('.spinner, #loading-spinner');
            allSpinners.forEach(spinner => spinner.remove());
            
            // Strategy 5: Global cleanup for body spinners
            if (element === document.body) {
                const globalSpinners = document.querySelectorAll('.spinner, #loading-spinner');
                globalSpinners.forEach(spinner => {
                    if (spinner.style.position === 'fixed') {
                        spinner.remove();
                    }
                });
            }
        }
    }
// Add this function to script.js
function filterProjectsByDestination(destinationId) {
    const projectSelect = document.getElementById('project');
    const allProjectOptions = Array.from(projectSelect.querySelectorAll('option'));

    console.log('Filtering for destinationId:', destinationId); // Debug log

    // If no destination selected, show all projects
    if (!destinationId || destinationId === null || destinationId === 'undefined') {
        console.log('No destination filter - showing all projects'); // Debug log
        
        allProjectOptions.forEach(option => {
            if (option.value) { // Skip the "Select a project" option
                const remainingTrips = parseInt(option.getAttribute('data-journeys')) || 0;
                
                // Always show the option
                option.style.display = '';
                option.hidden = false;
                option.removeAttribute('hidden');
                
                // But handle disabled state based on remaining trips
                if (remainingTrips <= 0) {
                    option.disabled = true;
                    option.style.color = '#999';
                    option.style.backgroundColor = '#f5f5f5';
                } else {
                    option.disabled = false;
                    option.style.color = '';
                    option.style.backgroundColor = '';
                }
            }
        });
        projectSelect.value = '';
        return;
    }

    console.log('Filtering projects for destination ID:', destinationId); // Debug log

    // Filter projects by destination and remaining trips
    allProjectOptions.forEach(option => {
        if (option.value) { // Skip the "Select a project" option
            const projectLocationId = option.getAttribute('data-location-id');
            const remainingTrips = parseInt(option.getAttribute('data-journeys')) || 0;
            
            console.log('Project:', option.textContent, 'LocationId:', projectLocationId, 'DestinationId:', destinationId, 'RemainingTrips:', remainingTrips); // Debug log
            
            if (projectLocationId !== destinationId.toString()) {
                // Hide projects that don't match the destination
                option.style.display = 'none';
                option.hidden = true;
                option.disabled = true;
            } else {
                // Show projects that match the destination
                option.style.display = '';
                option.hidden = false;
                option.removeAttribute('hidden');
                
                if (remainingTrips <= 0) {
                    // Gray out and disable projects with no remaining trips
                    option.disabled = true;
                    option.style.color = '#999';
                    option.style.backgroundColor = '#f5f5f5';
                } else {
                    // Enable projects with remaining trips
                    option.disabled = false;
                    option.style.color = '';
                    option.style.backgroundColor = '';
                }
            }
        }
    });

    // Reset the project selection
    projectSelect.value = '';
    console.log('Filtering completed'); // Debug log
}
    function formatDate(year, month, day) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
});