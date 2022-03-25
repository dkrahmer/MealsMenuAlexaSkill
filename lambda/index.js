/*
* Copyright 2022 Doug Krahmer. All Rights Reserved.
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

// dependencies
const Alexa = require("ask-sdk-core");
const moment = require("moment-timezone");
const axios = require("axios");

// constants
const appName = "Meals Menu";

// Get Meal by date intent handler
const GetMealByDateIntentHandler = {
	canHandle(handlerInput) {
		return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest"
			&& Alexa.getIntentName(handlerInput.requestEnvelope) === "GetMealByDateIntent";
	},
	async handle(handlerInput) {
		const { attributesManager } = handlerInput;
		const persistentAttributes = await attributesManager.getPersistentAttributes() || {};

		if (!persistentAttributes.mealsApiUrlBase) {
			return this.getResponseMissingMealsApiUrlBase(handlerInput);
		}
		
		let authorityMealTimeName = getSlotValueAuthority(handlerInput.requestEnvelope, "mealTimeName") || "all";
		
		const userTimeZoneId = await getUserTimeZoneId(handlerInput);
		const localNowMoment = moment().tz(userTimeZoneId);
		const todayDate = localNowMoment.format("YYYY-MM-DD");
		let date = Alexa.getSlotValue(handlerInput.requestEnvelope, "date") || todayDate; // Default to today's date

		let isFutureDate = date >= todayDate;
		if (isFutureDate && date === todayDate) {
			// for today only
			if (authorityMealTimeName === "breakfast" && localNowMoment.hour() > 11)
				isFutureDate = false;
			else if (authorityMealTimeName === "lunch" && localNowMoment.hour() > 15)
				isFutureDate = false;
			else if (authorityMealTimeName === "supper" && localNowMoment.hour() > 19)
				isFutureDate = false;
		}

		// Get meal(s) from the Google Sheet for the specified date
		const mealsApiUrl = `${persistentAttributes.mealsApiUrlBase}${(persistentAttributes.mealsApiUrlBase.includes("?") ? "&" : "?")}function=GetMealsByDate&passphrase=${persistentAttributes.passphrase}&date=${date}`; // date will be in this format: YYYY-MM-DD

		let meals;
		const day = getDayTerm(localNowMoment, moment(date).tz(userTimeZoneId, true));
		try {
			const response = await axios.get(mealsApiUrl);

			if (!response.data.success) {
				return handlerInput.responseBuilder
					.speak(`Sorry, the requested date could not be found. Reason: ${response.data.reason || "none given"}`)
					.withShouldEndSession(true)
					.getResponse();
			}
			meals = response.data.meals || [];
		}
		catch (error) {
			return handlerInput.responseBuilder
				.speak(`Sorry, there was a problem getting meals from the Google Sheets API for ${day}.`)
				.withShouldEndSession(true)
				.getResponse();
		}
		
		if (!meals[authorityMealTimeName]) {
			authorityMealTimeName = "all";
		}

		let speakOutput;

		let speakMealDescriptions = "";
		
		if (authorityMealTimeName === "all") {
			const mealTimeNames = ["breakfast", "lunch", "supper", "dessert"];

			for (let i = 0; i < mealTimeNames.length; i++) {
				const mealTimeName = mealTimeNames[i];
				const mealDescription = meals[mealTimeName];
				if (mealDescription) {
					speakMealDescriptions += `${mealTimeName}: ${mealDescription.split("--")[0].trim()}.  `;
				}
			}
			speakOutput = !speakMealDescriptions ? `Meals ${day} ${(isFutureDate ? "are" : "were")} not planned.` : `Meals ${day} ${(isFutureDate ? "will be" : "were")} as follows: ${speakMealDescriptions}.`;
		}
		else {
			speakMealDescriptions = meals[authorityMealTimeName];

			speakOutput = !speakMealDescriptions ? `${authorityMealTimeName} ${day} ${isFutureDate ? "is" : "was"} not planned.` : `${authorityMealTimeName} ${day} ${(isFutureDate ? "will include" : "included")} ${speakMealDescriptions.split("--")[0].trim()}.`;
		}
		
		let cardExtraMessage = "";
		if (!speakMealDescriptions) {
			cardExtraMessage = " Please ensure the date exists in your Meals Menu Google Sheet and that a description is filled in for the meal.";
		}

		return handlerInput.responseBuilder
			.speak(speakOutput)
			// Uncomment the next line if you want to keep the session open so you can
			// ask for another fact without first re-opening the skill
			// .reprompt(requestAttributes.t('HELP_REPROMPT'))
			.withSimpleCard(appName, speakOutput + cardExtraMessage)
			.withShouldEndSession(true)
			.getResponse();
	}
};

// Get Meal by description intent handler
const GetMealByDescriptionIntentHandler = {
	canHandle(handlerInput) {
		return Alexa.getRequestType(handlerInput.requestEnvelope) === "IntentRequest"
			&& Alexa.getIntentName(handlerInput.requestEnvelope) === "GetMealByDescriptionIntent";
	},
	async handle(handlerInput) {
		const { attributesManager } = handlerInput;
		const persistentAttributes = await attributesManager.getPersistentAttributes() || {};

		if (!persistentAttributes.mealsApiUrlBase) {
			return this.getResponseMissingMealsApiUrlBase(handlerInput);
		}
		
		const userTimeZoneId = await getUserTimeZoneId(handlerInput);
		
		const pastPhraseTemplate1 = [
			{ values: ["", "did"] },
			{ values: ["", "we", "i", "you", "the", "to"] },
			{ values: ["", "last"] },
			{ values: ["have", "had", "eat", "ate", "eight", "gate", "made", "make", "get", "got"]}
		];
		
		const pastPhraseTemplate2 = [
			{ values: ["is the last", "the last", "it's last", "was the last", "is last", "was last", "did"] },
			{ values: ["", "time", "day", "date"] },
			{ values: ["", "we", "i", "you", "the", "to"] },
			{ values: ["", "last"] },
			{ values: ["had", "have", "eat", "ate", "eight", "gate", "made", "make", "get", "got"] }
		];
		
		const futurePhraseTemplate = [
			{ values: ["", "is the next", "is next", "next", "the next"] },
			{ values: ["", "time", "day", "date"] },
			{ values: ["will we", "we will", "you will", "will i", "i will", "are we", "we are", "we're", "am i", "i am", "i'm", 
				"are we going to", "are we gonna", "we are going to", "we are gonna", "you are going to", "you are gonna", "we going", "we going to", "we're going to", "we're gonna", 
				"am i going to", "am i gonna", "i am going to", "i am gonna", "i'm going to", "i'm gonna"] },
			{ values: ["have", "eat", "having", "eating", "be having", "be eating", "make", "be making"] }
		];
		
		const mealRequestPhrase = getSlotValue(handlerInput.requestEnvelope, "mealRequestPhrase");
		let mealDescription = getPhraseSuffix(mealRequestPhrase, pastPhraseTemplate1) || getPhraseSuffix(mealRequestPhrase, pastPhraseTemplate2);

		const isFuture = !mealDescription;

		mealDescription = mealDescription || getPhraseSuffix(mealRequestPhrase, futurePhraseTemplate);
		if (!mealDescription) {
			return handlerInput.responseBuilder
				.speak(`I could not understand your request: ${mealRequestPhrase}`)
				.withShouldEndSession(true)
				.getResponse();
		}
		
		const phraseSuffixTrimStrings = [ "next", "again", "last" ];
		mealDescription = trimPhraseSuffix(mealDescription, phraseSuffixTrimStrings);

		const when = isFuture ? "future" : "past";
		const localNowMoment = moment().tz(userTimeZoneId);
		const todayDate = localNowMoment.format("YYYY-MM-DD");
		
		const mealsApiUrl = `${persistentAttributes.mealsApiUrlBase}${(persistentAttributes.mealsApiUrlBase.includes("?") ? "&" : "?")}function=GetMealByDescription&passphrase=${persistentAttributes.passphrase}&mealDescription=${mealDescription}&when=${when}&startDate=${todayDate}`;

		let foundMeal;

		try {
			const response = await axios.get(mealsApiUrl);

			if (!response.data.success || !response.data.meal) {
				return handlerInput.responseBuilder
					.speak(`I could not find ${mealDescription} in a ${when} meal.`)
					.withShouldEndSession(true)
					.getResponse();
			}
			
			foundMeal = response.data.meal;
		}
		catch (error) {
			return handlerInput.responseBuilder
				.speak(`Sorry, there was a problem searching meals from the Google Sheets API for ${mealDescription}.`)
				.withShouldEndSession(true)
				.getResponse();
		}
		
		let speakOutput;
		const day = getDayTerm(localNowMoment, moment(foundMeal.date).tz(userTimeZoneId, true));
			
		speakOutput = `${mealDescription} ${(isFuture ? "is" : "was last")} scheduled for ${foundMeal.mealTimeName} ${day} as follows: ${foundMeal.description.split("--")[0].trim()}`;

		return handlerInput.responseBuilder
			.speak(speakOutput)
			// Uncomment the next line if you want to keep the session open so you can
			// ask for another fact without first re-opening the skill
			// .reprompt(requestAttributes.t('HELP_REPROMPT'))
			.withSimpleCard(appName, speakOutput)
			.withShouldEndSession(true)
			.getResponse();
	}
};

const getPhraseSuffix = (phrase, phraseTemplate) => {
	phrase = phrase.trim().toLowerCase(); // standardize the input
	
	for (let i = 0; i < phraseTemplate.length; i++) {
		const phraseTemplateElement = phraseTemplate[i];
		let matchingPhrasePortion = null;
		
		for (let j = 0; j < phraseTemplateElement.values.length; j++) {
			const phrasePortion = phraseTemplateElement.values[j];
			if ((matchingPhrasePortion === null || phrasePortion.length > matchingPhrasePortion.length)
					&& (phrasePortion === "" || phrase.startsWith(phrasePortion))) {
				matchingPhrasePortion = phrasePortion; // save the longest match
			}
		}

		if (matchingPhrasePortion === null) 
			return null; // does not match
			
		phrase = phrase.substr(matchingPhrasePortion.length).trim();
	}
	
	return phrase; // The first part of the phrase has been removed, leaving the suffix
}

const trimPhraseSuffix = (phrase, phraseSuffixTrimStrings) => {
	phrase = phrase.trim().toLowerCase(); // standardize the input
	
	for (let i = 0; i < phraseSuffixTrimStrings.length; i++) {
		const phraseSuffixTrimString = phraseSuffixTrimStrings[i];
		let matchingPhrasePortion = null;

		if ((matchingPhrasePortion === null || phraseSuffixTrimString.length > matchingPhrasePortion.length)
				&& phrase.endsWith(phraseSuffixTrimString)) {
			matchingPhrasePortion = phraseSuffixTrimString; // save the longest match
		}
		
		if (matchingPhrasePortion)
			phrase = phrase.substr(0, phrase.length - matchingPhrasePortion.length).trim();
	}
	
	return phrase; // The first part of the phrase has been removed, leaving the suffix
}

const getResponseMissingMealsApiUrlBase = (handlerInput) => {
	const speakOutput = "Your Meals Menu Google Sheet has not been linked yet.  Please go to the following web URL for setup instructions: ";
	return handlerInput.responseBuilder
		.speak(speakOutput + "tiny URL dot com, forward slash, meals menu")
		.withSimpleCard(appName, speakOutput + "https://tinyurl.com/mealsmenu")
		.withShouldEndSession(true)
		.getResponse();
};

const CanFulfillGetMealIntentRequestHandler = {
	canHandle(handlerInput) {
		return Alexa.getRequestType(handlerInput.requestEnvelope) === "CanFulfillIntentRequest"
			&& Alexa.getIntentName(handlerInput.requestEnvelope) === "GetMealIntent";
	},
	handle(handlerInput) {
		const getMealInitializer = Alexa.getSlotValue(handlerInput.requestEnvelope, "getMealInitializer");
		const meal = Alexa.getSlotValue(handlerInput.requestEnvelope, "meal");
		const date = Alexa.getSlotValue(handlerInput.requestEnvelope, "date");

		const getMealInitializerFulfill = !!getMealInitializer;
		const mealFulfill = !!meal;
		const dateFulfill = !!date;

		const canFulfill = mealFulfill // fulfill if only the meal is available
			|| (getMealInitializerFulfill && getMealInitializer.length > 6 && dateFulfill); // fulfill if the getMealInitializer is not short and date is available
		
		// Documentation:
		//      https://developer.amazon.com/en-US/docs/alexa/custom-skills/implement-canfulfillintentrequest-for-name-free-interaction.html
		//      https://developer.amazon.com/en-US/docs/alexa/custom-skills/understand-name-free-interaction-for-custom-skills.html
		//      https://developer.amazon.com/en-US/docs/alexa/custom-skills/request-types-reference.html#canfulfillintent
		//      https://developer.amazon.com/en-US/docs/alexa/custom-skills/request-types-reference.html#CanFulfillIntentRequest
		
		// Approach to validating slot values with custom getSlotValues function: https://github.com/bbezerra82/canFulfillIntentRequest/blob/master/canFulfillPaul/lambda/custom/index.js
		
		const ability = {
				"canFulfill": canFulfill ? "YES" : "NO",
				"slots": {  // slots
					"getMealInitializer": {
						"canUnderstand": canFulfill ? "YES" : "NO",
						"canFulfill": canFulfill ? "YES" : "NO"
					}, "meal": {
						"canUnderstand": canFulfill ? "YES" : "NO",
						"canFulfill": canFulfill ? "YES" : "NO"
					}, "date": {
						"canUnderstand": canFulfill ? "YES" : "NO",
						"canFulfill": canFulfill ? "YES" : "NO"
					},
				}
			};
		
		return handlerInput.responseBuilder
			.withCanFulfillIntent(ability)
			.getResponse();

		/*
		return handlerInput.responseBuilder
			.withCanFulfillIntent({
				"canFulfill": canFulfill ? "YES" : "NO",
				"slots": {
					"getMealInitializer": {
						"canUnderstand": getMealInitializerFulfill ? "YES" : "NO",
						"canFulfill": canFulfill && getMealInitializerFulfill ? "YES" : "NO"
					}, "meal": {
						"canUnderstand": mealFulfill ? "YES" : "NO",
						"canFulfill": canFulfill && mealFulfill ? "YES" : "NO"
					}, "date": {
						"canUnderstand": dateFulfill ? "YES" : "NO",
						"canFulfill": canFulfill && dateFulfill ? "YES" : "NO"
					},
				}
			})
			.getResponse();
		*/
	}
};

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

		if (apiUrlKeyWord === "clear all") { // clear all is the special key word to clear all settings
			await attributesManager.deletePersistentAttributes();
			
			const speakOutput = `${appName} persistent attributes have been cleared.`;
			return handlerInput.responseBuilder
				.speak(speakOutput)
				.withSimpleCard(appName, speakOutput)
				.withShouldEndSession(true)
				.getResponse();
		}

		let mealsApiUrlBase;

		try {
			// Get API URL from short URL
			const shortUrl = `https://www.yellkey.com/${apiUrlKeyWord}`;

			try {
				const response = await axios.get(shortUrl, { maxRedirects: 1 }); // Stop the redirect chain after 1 to get the desired Google URL.

				// The above line will throw an exception when the URL redirect is correct.
				const speakOutput = "Sorry, the target API URL does not appear to be correct or the Google sheet script threw an exception.";
				return handlerInput.responseBuilder
					.speak(speakOutput)
					.withSimpleCard(appName, speakOutput)
					.withShouldEndSession(true)
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
				const speakOutput = "Sorry, the specified URL short name does not appear to be valid.";
				return handlerInput.responseBuilder
					.speak(speakOutput)
					.withSimpleCard(appName, speakOutput)
					.withShouldEndSession(true)
					.getResponse();
			}
		}
		catch (error) {
			return handlerInput.responseBuilder.speak(`Sorry, there was a problem getting the API URL. Please try again later.`).getResponse();
		}

		if (!mealsApiUrlBase) {
			const speakOutput = "Sorry, I could not find an API URL with that ID.";
			return handlerInput.responseBuilder
				.speak(speakOutput)
				.withSimpleCard(appName, speakOutput)
				.withShouldEndSession(true)
				.getResponse();
		}

		const passphrase = (Alexa.getSlotValue(handlerInput.requestEnvelope, "passphrase") || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase(); // remove spaces and convert to lowercase
		
		const persistentAttributes = await attributesManager.getPersistentAttributes() || {};
		persistentAttributes.mealsApiUrlBase = mealsApiUrlBase;
		persistentAttributes.passphrase = passphrase;
		attributesManager.setPersistentAttributes(persistentAttributes);
		await attributesManager.savePersistentAttributes();

		const speakOutput = "The API URL has been set. Your Meals Menu Google sheet has been successfully linked.";
		return handlerInput.responseBuilder
			.speak(speakOutput)
			.withSimpleCard(appName, speakOutput + `  API URL: ${persistentAttributes.mealsApiUrlBase}`)
			.withShouldEndSession(true)
			.getResponse();
	}
}

const CanFulfillSetMealsApiUrlIntentRequestHandler = {
	canHandle(handlerInput) {
		return Alexa.getRequestType(handlerInput.requestEnvelope) === "CanFulfillIntentRequest"
			&& Alexa.getIntentName(handlerInput.requestEnvelope) === "SetMealsApiUrlIntent";
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
			.withShouldEndSession(true)
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
		return Alexa.getRequestType(handlerInput.requestEnvelope) === "CanFulfillIntentRequest";
	},
	handle(handlerInput, error) {
		console.log(`CanFulfillIntentRequest Error handled: ${error.message}`);

		return handlerInput.responseBuilder
			.withCanFulfillIntent({
				"canFulfill": "NO",
				"slots": { }
			})
			.getResponse();
	}
};

const getSlotValue = (requestEnvelope, slotName) => {
	try {
		const slot = Alexa.getSlot(requestEnvelope, slotName);
		if (!slot)
			return null;
			
		return slot.value;
	}
	catch (error) {
		return null;
	}
}

const getSlotValueAuthority = (requestEnvelope, slotName) => {
	try {
		const slot = Alexa.getSlot(requestEnvelope, slotName);
		if (!slot)
			return null;
			
		const resolutions = slot.resolutions;
		if (!slot.resolutions || !slot.resolutions.resolutionsPerAuthority)
			return null;
			
		return resolutions.resolutionsPerAuthority[0].values[0].value.name;
	}
	catch (error) {
		return null;
	}
}

const getUserTimeZoneId = async (handlerInput) => {
	try
	{
		const deviceId = handlerInput.requestEnvelope.context.System.device.deviceId;
		const upsServiceClient = handlerInput.serviceClientFactory.getUpsServiceClient();
		const userTimeZoneId = await upsServiceClient.getSystemTimeZone(deviceId);

		if (!userTimeZoneId)
			throw "No timezone ID found";
		
		return userTimeZoneId;
	}
	catch (ex) {
		// default time zone ID
		return "America/Los_Angeles";
	}
}

const momentFormats = {
	sameDay: "[today]",
	nextDay: "[tomorrow]",
	nextWeek: "[on] dddd, MMMM Do",
	lastDay: "[yesterday]",
	lastWeek: "[last] dddd, MMMM Do",
	sameElse: "[on] dddd, MMMM Do YYYY" // Do = 5th, etc.
};

const getDayTerm = (startMoment, targetMoment) =>
{
	startMoment = startMoment.startOf("day");
	targetMoment = targetMoment.startOf("day");

	let day = targetMoment.calendar(startMoment, momentFormats);
	let daysDiff = startMoment.diff(targetMoment, "days");
	const isFuture = daysDiff < 0;
	daysDiff = Math.abs(daysDiff);
	
	if (daysDiff > 1)
		day = (isFuture ? `in ${daysDiff} days` : `${daysDiff} days ago`) + ", " + day;
	
	return day;
}

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
	.withApiClient(new Alexa.DefaultApiClient())
	.addRequestHandlers(
		//CanFulfillGetMealIntentRequestHandler,
		GetMealByDateIntentHandler,
		GetMealByDescriptionIntentHandler,
		LaunchRequestHandler,
		SetMealsApiUrlIntentHandler,
		//CanFulfillSetMealsApiUrlIntentRequestHandler,
		HelpIntentHandler,
		ExitHandler
	)
	.addErrorHandlers(
		ErrorHandler//,
		//CanFulfillIntentRequestErrorHandler
	)
	.lambda();
