/*
 * Copyright 2019 Doug Krahmer. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

// sets up dependencies
const Alexa = require("ask-sdk-core");
const moment = require("moment-timezone");
const axios = require("axios");
const appName = "Meals Menu";

const LaunchRequestHandler = {
	canHandle(handlerInput) {
		return Alexa.getRequestType(handlerInput.requestEnvelope) === "LaunchRequest";
	},
	handle(handlerInput) {
		const speakOutput = "Which meal and day would you like to know?";
		return handlerInput.responseBuilder
			.speak(speakOutput)
        	.withSimpleCard(appName, speakOutput)
			.reprompt(speakOutput)
			.getResponse();
	}
};

const SetMealsApiUrlIntentHandler = {
	canHandle(handlerInput) {
		return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest"
			&& Alexa.getIntentName(handlerInput.requestEnvelope) === "SetMealsApiUrlIntent";
	},
	async handle(handlerInput) {
		const apiUrlKeyWord = Alexa.getSlotValue(handlerInput.requestEnvelope, "apiUrlKeyWord");
		
	    const { attributesManager } = handlerInput;
        const persistentAttributes = await attributesManager.getPersistentAttributes() || {};

        let mealsApiUrlBase;
        
        try {
            // Get API URL from short URL
            //mealsApiUrlBase = "https://script.google.com/macros/s/AKfycbwgT2T7Gh9qOfsqVk3Qd0Hx8j8x5iCt04SdjkIkLcbnTV7uQtYQ/exec";
            
        	const shortUrl = `https://www.yellkey.com/${apiUrlKeyWord}`;
        
        	try {
        		const response = await axios.get(shortUrl, { maxRedirects: 1 }); // Stop the redirect chain after 1 to get the desired Google URL.
        
        		// The above line will throw an exception when the URL redirect is correct.
          		const speakOutput = "The target API URL does not appear to be correct.";
                return handlerInput.responseBuilder
        			.speak(speakOutput)
        			.withSimpleCard(appName, speakOutput)
        			.getResponse();
        	}
        	catch (error) {
        		try {
        			mealsApiUrlBase = error.request._currentRequest._redirectable._currentUrl;
        		}
        		catch (error2) {
        			mealsApiUrlBase = "";
        		}
        	}
        
        	if (!mealsApiUrlBase) {
          		const speakOutput = "The specified URL short name does not appear to be valid.";
                return handlerInput.responseBuilder
        			.speak(speakOutput)
        			.withSimpleCard(appName, speakOutput)
        			.getResponse();
        	}
        }
        catch (error) {
			return handlerInput.responseBuilder.speak(`There was a problem getting the API URL. Please try again later.`).getResponse();
        }
        
        if (!mealsApiUrlBase) {
            const speakOutput = "I could not find an API URL with that ID.";
            return handlerInput.responseBuilder
    			.speak(speakOutput)
    			.withSimpleCard(appName, speakOutput)
    			.getResponse();
        }
        
        persistentAttributes.mealsApiUrlBase = mealsApiUrlBase;
	    attributesManager.setPersistentAttributes(persistentAttributes);
        await attributesManager.savePersistentAttributes();
        
        const speakOutput = "The API URL has been set.";
        return handlerInput.responseBuilder
			.speak(speakOutput)
			.withSimpleCard(appName, speakOutput + `  API URL: ${persistentAttributes.mealsApiUrlBase}`)
			.getResponse();
	}
}

// core functionality for "get meal" skill
const GetMealIntentHandler = {
	canHandle(handlerInput) {
		return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest"
			&& Alexa.getIntentName(handlerInput.requestEnvelope) === "GetMealIntent";
	},
	async handle(handlerInput) {
		let userTimeZone = "America/Los_Angeles";

		/*
		// Get device timezone (only works is devleoped using ASK CLI)
		const deviceId = Alexa.getDeviceId(handlerInput.requestEnvelope);

		try {
			const upsServiceClient = handlerInput.serviceClientFactory.getUpsServiceClient();
			userTimeZone = await upsServiceClient.getSystemTimeZone(deviceId);
		} catch (error) {
			if (error.name !== 'ServiceError') {
				return handlerInput.responseBuilder.speak(`There was a problem connecting to the timezone service. deviceId = ${deviceId}`).getResponse();
			}
			console.log('error', error.message);
		}
		*/

		const meal = Alexa.getSlotValue(handlerInput.requestEnvelope, "meal") || "all";
		const authorityMeal = meal === "all" ? "all" : handlerInput.requestEnvelope.request.intent.slots.meal.resolutions.resolutionsPerAuthority[0].values[0].value.name;
		
		const localNowMoment = moment().tz(userTimeZone);
		const todayDate = localNowMoment.format("YYYY-MM-DD");
		let date = Alexa.getSlotValue(handlerInput.requestEnvelope, "date") || todayDate; // Default to today's date

		const day = moment(date).tz(userTimeZone, true).calendar(localNowMoment, {
			sameDay: "[today]",
			nextDay: "[tomorrow]",
			nextWeek: "[on] dddd, MMMM Do",
			lastDay: "[yesterday]",
			lastWeek: "[last] dddd, MMMM Do",
			sameElse: "[on] dddd, MMMM Do YYYY" // Do = 5th, etc.
		});

		let isFutureDate = date >= todayDate;
		if (isFutureDate && date === todayDate) {
			// for today only
			if (authorityMeal === "breakfast" && localNowMoment.hour() > 11)
				isFutureDate = false;
			else if (authorityMeal === "lunch" && localNowMoment.hour() > 15)
				isFutureDate = false;
			else if (authorityMeal === "supper" && localNowMoment.hour() > 19)
				isFutureDate = false;
		}

		let food = "";

		// Get the food from the Google Sheet for the specified date
	    const { attributesManager } = handlerInput;
        const persistentAttributes = await attributesManager.getPersistentAttributes() || {};

        if (!persistentAttributes.mealsApiUrlBase) {
            const speakOutput = "Your Meals Menu Google Sheet has not been linked yet.  Please go to the following web URL for setup instructions: ";
            return handlerInput.responseBuilder
    			.speak(speakOutput + "tiny URL dot com, forward slash, meals menu")
    			.withSimpleCard(appName, speakOutput + "https://tinyurl.com/mealsmenu")
    			.getResponse();
        }
        
		const mealsApiUrl = `${persistentAttributes.mealsApiUrlBase}${(persistentAttributes.mealsApiUrlBase.includes("?") ? "&" : "?")}date=${date}`; // The date will be in this format: YYYY-MM-DD

		let response;
		let meals;

		try {
			response = await axios.get(mealsApiUrl);
			meals = response.data.meals || { };
		}
		catch (error) {
			return handlerInput.responseBuilder.speak(`There was a problem getting meals to the Google Sheets API for ${date}.`).getResponse();
		}

		let speakOutput;
	
		if (authorityMeal === "all") {
			const mealNames = ["breakfast", "lunch", "supper", "dessert"];

			for (let i = 0; i < mealNames.length; i++) {
				const mealName = mealNames[i];
				const mealFood = meals[mealName];
				if (mealFood) {
					food += `${mealName}: ${mealFood}.  `;
				}
			}
			speakOutput = !food ? `$Meals ${day} ${isFutureDate ? "are" : "were"} not planned.` : `Meals ${day} ${(isFutureDate ? "will be" : "were")} as follows: ${food}.`;
		}
		else {
			food = meals[authorityMeal];

			speakOutput = !food ? `${authorityMeal} ${day} ${isFutureDate ? "is" : "was"} not planned.` : `${authorityMeal} ${day} ${(isFutureDate ? "will include" : "included")} ${food}.`;
		}

		return handlerInput.responseBuilder
			.speak(speakOutput)
			// Uncomment the next line if you want to keep the session open so you can
			// ask for another fact without first re-opening the skill
			// .reprompt(requestAttributes.t('HELP_REPROMPT'))
			.withSimpleCard(appName, speakOutput)
			.getResponse();
	}
};

const CanFulfillGetMealIntentRequestHandler = {
	canHandle(handlerInput) {
		return Alexa.getRequestType(handlerInput.requestEnvelope) === "CanFulfillIntentRequest"
			&& handlerInput.requestEnvelope.request.intent.name === "GetMealIntent";
	},
	handle(handlerInput) {
	    const getMealInitializer = handlerInput.requestEnvelope.request.intent.slots.getMealInitializer;
	    const meal = handlerInput.requestEnvelope.request.intent.slots.meal;
	    const date = handlerInput.requestEnvelope.request.intent.slots.date;
	    
	    const getMealInitializerFulfill = !!getMealInitializer;
	    const mealFulfill = !!meal;
	    const dateFulfill = !!date;
	    
		const canFulfill = !!meal // fulfill if only the meal ia available
		    || (getMealInitializerFulfill && getMealInitializer.length > 6 && dateFulfill); // fulfill if the getMealInitializer is not short and date is available

		return handlerInput.responseBuilder
			.withCanFulfillIntent({
				"canFulfill": canFulfill ? "YES" : "NO",
				"slots": {
					"getMealInitializer": {
						"canUnderstand": getMealInitializerFulfill ? "YES" : "NO",
						"canFulfill": canFulfill && getMealInitializerFulfill ? "YES" : "NO"
					},"meal": {
						"canUnderstand": mealFulfill ? "YES" : "NO",
						"canFulfill": canFulfill && mealFulfill ? "YES" : "NO"
					},"date": {
						"canUnderstand": dateFulfill ? "YES" : "NO",
						"canFulfill": canFulfill && dateFulfill ? "YES" : "NO"
					},
				}
			})
			.getResponse();
	}
};

const CanFulfillSetMealsApiUrlIntentRequestHandler = {
	canHandle(handlerInput) {
		return Alexa.getRequestType(handlerInput.requestEnvelope) === "CanFulfillIntentRequest"
			&& handlerInput.requestEnvelope.request.intent.name === "SetMealsApiUrlIntent";
	},
	handle(handlerInput) {
		return handlerInput.responseBuilder
			.withCanFulfillIntent({
				"canFulfill": "NO",
				"slots": {
				    "apiUrlKeyWord": {
						"canUnderstand": "YES",
						"canFulfill": "NO"
					}
				}
			})
			.getResponse();
	}
};

const HelpIntentHandler = {
	canHandle(handlerInput) {
		return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
			&& Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
	},
	handle(handlerInput) {
		return LaunchRequestHandler.handle(handlerInput);
	}
};

const ExitHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
            || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();

    return handlerInput.responseBuilder
        .getResponse(); // just exit silently
    },
};

// Generic error handling to capture any syntax or routing errors. If you receive an error
// stating the request handler chain is not found, you have not implemented a handler for
// the intent being invoked or included it in the skill builder below.
const ErrorHandler = {
	canHandle() {
		return true;
	},
	handle(handlerInput, error) {
		console.log(`~~~~ Error handled: ${error.stack}`);
		const speakOutput = "Sorry, I had trouble doing what you asked. Please try again.";

		return handlerInput.responseBuilder
			.speak(speakOutput)
			.reprompt(speakOutput)
			.getResponse();
	}
};

const CanFulfillIntentRequestErrorHandler = {
	canHandle(handlerInput) {
		return handlerInput.requestEnvelope.request.type === "CanFulfillIntentRequest";
	},
	handle(handlerInput, error) {
		console.log(`CanFulfillIntentRequest Error handled: ${error.message}`);

		return handlerInput.responseBuilder
			.withCanFulfillIntent(
				{
					"canFulfill": "NO",
					"slots": {
						"meal": {
							"canUnderstand": "NO",
							"canFulfill": "NO"
						}
					}
				})
			.getResponse();
	}
};

function getPersistenceAdapter() {
   // Determines persistence adapter to be used based on environment
    const s3Adapter = require('ask-sdk-s3-persistence-adapter');
    return new s3Adapter.S3PersistenceAdapter({
        bucketName: process.env.S3_PERSISTENCE_BUCKET,
    });
}

// The SkillBuilder acts as the entry point for your skill, routing all request and response
// payloads to the handlers above. Make sure any new handlers or interceptors you've
// defined are included below. The order matters - they're processed top to bottom.
exports.handler = Alexa.SkillBuilders.custom()
    .withPersistenceAdapter(getPersistenceAdapter())
	.addRequestHandlers(
	    SetMealsApiUrlIntentHandler,
		LaunchRequestHandler,
		GetMealIntentHandler,
		CanFulfillGetMealIntentRequestHandler,
		CanFulfillSetMealsApiUrlIntentRequestHandler,
		HelpIntentHandler,
	    ExitHandler
	)
	.addErrorHandlers(
		ErrorHandler,
		CanFulfillIntentRequestErrorHandler
	)
	.lambda();
